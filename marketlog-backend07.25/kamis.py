"""KAMIS(농산물유통정보) Open API 연동 — 품목 인식 모델의 실제 10개 클래스에 대한
소매가격을 조회한다. dailyPriceByCategoryList는 카테고리 전체를 한 번에 반환하므로
날짜당 한 번만 호출해 메모리에 캐시한다.
"""
from __future__ import annotations

import asyncio
import os
from datetime import date, datetime, timedelta

import httpx

KAMIS_BASE_URL = "https://www.kamis.or.kr/service/price/xml.do"
# KAMIS는 http/기본 User-Agent로는 연결을 리셋시키고 https + 브라우저 UA에서만 응답한다.
KAMIS_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

# 품목명 -> KAMIS 조회 설정.
# kind_contains: kind_name 중 어떤 품종을 대표값으로 쓸지 (None이면 첫 매치 사용)
# unit_weight_kg: KAMIS가 매기는 가격 단위(1개/1포기/10개/100g 등)가 실제로 몇 kg에
#   해당하는지의 근사 평균 중량. 전 품목을 1kg 기준가로 통일해서 비교하기 위해
#   dpr1(단위당 가격)을 이 값으로 나눠서 원/kg으로 환산한다.
#   양파·마늘·감자는 KAMIS 자체가 이미 kg 단위라 그대로 1(또는 0.1)을 씀.
#   개수/포기 단위 품목(무·배추·양배추·사과·배·감귤)은 국립농산물품질관리원 표준규격 등에서
#   흔히 인용되는 평균 중량을 근사치로 사용한 것으로, 실측치가 아니라 참고용 추정이다.
ITEM_CONFIG = {
    "무": {"category": "200", "kamis_name": "무", "kind_contains": None, "unit_weight_kg": 1.5},       # 1개 ≈ 1.5kg
    "배추": {"category": "200", "kamis_name": "배추", "kind_contains": "고랭지", "unit_weight_kg": 2.5},  # 1포기 ≈ 2.5kg
    "양파": {"category": "200", "kamis_name": "양파", "kind_contains": None, "unit_weight_kg": 1},        # 이미 1kg 단위
    "마늘": {"category": "200", "kamis_name": "깐마늘(국산)", "kind_contains": None, "unit_weight_kg": 1},  # 이미 1kg 단위
    "양배추": {"category": "200", "kamis_name": "양배추", "kind_contains": None, "unit_weight_kg": 2},     # 1포기 ≈ 2kg
    "감자": {"category": "100", "kamis_name": "감자", "kind_contains": None, "unit_weight_kg": 0.1},       # 100g 단위
    "사과": {"category": "400", "kamis_name": "사과", "kind_contains": "후지", "unit_weight_kg": 3},       # 10개 ≈ 3kg (개당 300g)
    "배": {"category": "400", "kamis_name": "배", "kind_contains": None, "unit_weight_kg": 5},             # 10개 ≈ 5kg (개당 500g)
    "감귤": {"category": "400", "kamis_name": "감귤", "kind_contains": None, "unit_weight_kg": 1},         # 10개 ≈ 1kg (개당 100g)
    "감": {"category": "400", "kamis_name": "감", "kind_contains": None, "unit_weight_kg": 2},             # 10개 ≈ 2kg (개당 200g) — 현재 KAMIS 품목코드 없어 항상 폴백
}

# 우리 3단계 등급(특/상/보통) -> KAMIS 소매가격의 2단계 등급(상품/중품) 근사 매핑.
# KAMIS 소매가는 상품(고급)/중품(중급) 두 단계만 제공해서 완전히 대응되진 않는다.
GRADE_TO_RANK = {"특": "상품", "상": "상품", "보통": "중품"}

_cache: dict = {"date": None, "prices": {}}


def _fetch_category(category: str, regday: str) -> list:
    cert_key = os.getenv("KAMIS_CERT_KEY")
    cert_id = os.getenv("KAMIS_CERT_ID")
    if not cert_key or not cert_id:
        return []
    params = {
        "action": "dailyPriceByCategoryList",
        "p_product_cls_code": "01",  # 01=소매, 02=도매
        "p_item_category_code": category,
        "p_regday": regday,
        "p_convert_kg_yn": "N",
        "p_cert_key": cert_key,
        "p_cert_id": cert_id,
        "p_returntype": "json",
    }
    try:
        resp = httpx.get(
            KAMIS_BASE_URL, params=params, timeout=10,
            headers={"User-Agent": KAMIS_USER_AGENT},
        )
        data = resp.json().get("data")
        if isinstance(data, dict):
            return data.get("item", [])
    except Exception as e:
        print(f"KAMIS API 호출 실패 (category={category}, regday={regday}): {e}")
    return []


def _build_prices_for_date(regday: str) -> dict:
    categories = {cfg["category"] for cfg in ITEM_CONFIG.values()}
    items_by_category = {cat: _fetch_category(cat, regday) for cat in categories}

    prices: dict = {}
    for item_name, cfg in ITEM_CONFIG.items():
        candidates = [
            it for it in items_by_category.get(cfg["category"], [])
            if it.get("item_name") == cfg["kamis_name"]
            and (cfg["kind_contains"] is None or cfg["kind_contains"] in it.get("kind_name", ""))
        ]
        by_rank = {}
        for it in candidates:
            raw = str(it.get("dpr1", "-")).replace(",", "")
            if raw in ("-", ""):
                continue
            try:
                by_rank[it.get("rank")] = round(int(raw) / cfg["unit_weight_kg"])
            except ValueError:
                continue
        if by_rank:
            prices[item_name] = by_rank
    return prices


def _refresh_cache() -> None:
    today = date.today()
    prices = {}
    for days_back in range(5):
        regday = (today - timedelta(days=days_back)).isoformat()
        prices = _build_prices_for_date(regday)
        if prices:
            break
    _cache["date"] = today
    _cache["prices"] = prices


async def auto_refresh_loop() -> None:
    """서버 기동 시 즉시 한 번 갱신하고, 이후 매일 자정마다 자동으로 다시 받아온다.
    사용자 요청이 없어도 캐시가 그날 데이터로 미리 채워진다."""
    while True:
        await asyncio.to_thread(_refresh_cache)
        tomorrow = datetime.combine(date.today() + timedelta(days=1), datetime.min.time())
        await asyncio.sleep((tomorrow - datetime.now()).total_seconds())


def get_public_price(item_name: str, grade_kor: str) -> "int | None":
    """오늘(없으면 최근 영업일) KAMIS 소매가격에서 등급에 맞는 가격을 원/kg 단위로 반환.
    데이터가 없으면(휴장일, 비계절 품목, 인증키 미설정, API 실패 등) None —
    호출부는 이 경우 기존 정적 PUBLIC_PRICE_MAP으로 폴백해야 한다.
    """
    if _cache["date"] != date.today():
        _refresh_cache()

    by_rank = _cache["prices"].get(item_name)
    if not by_rank:
        return None
    rank = GRADE_TO_RANK.get(grade_kor, "상품")
    if rank in by_rank:
        return by_rank[rank]
    # 감귤처럼 상품/중품이 아니라 크기 등급(M과/S과 등)만 있는 경우 아무 값이나 대표로 사용
    return next(iter(by_rank.values()))
