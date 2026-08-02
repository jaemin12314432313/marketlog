"""KAMIS(농산물유통정보) Open API 연동 — 품목 인식 모델의 실제 10개 클래스에 대한
소매가격을 조회한다. dailyPriceByCategoryList는 카테고리 전체를 한 번에 반환하므로
날짜당 한 번만 호출해 메모리에 캐시한다.
"""
from __future__ import annotations

import os
from datetime import date, timedelta

import httpx

KAMIS_BASE_URL = "https://www.kamis.or.kr/service/price/xml.do"
# KAMIS는 http/기본 User-Agent로는 연결을 리셋시키고 https + 브라우저 UA에서만 응답한다.
KAMIS_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

# 품목명 -> KAMIS 조회 설정.
# kind_contains: kind_name 중 어떤 품종을 대표값으로 쓸지 (None이면 첫 매치 사용)
# scale: KAMIS 표시 단위를 우리 앱 표시 단위(1개/1kg/1포기)로 맞추는 배율
#   예) 사과는 KAMIS가 "10개" 단위라 1개당 가격으로 보려면 0.1을 곱함
ITEM_CONFIG = {
    "무": {"category": "200", "kamis_name": "무", "kind_contains": None, "scale": 1},
    "배추": {"category": "200", "kamis_name": "배추", "kind_contains": "고랭지", "scale": 1},
    "양파": {"category": "200", "kamis_name": "양파", "kind_contains": None, "scale": 1},
    "마늘": {"category": "200", "kamis_name": "깐마늘(국산)", "kind_contains": None, "scale": 1},
    "양배추": {"category": "200", "kamis_name": "양배추", "kind_contains": None, "scale": 1},
    "감자": {"category": "100", "kamis_name": "감자", "kind_contains": None, "scale": 10},
    "사과": {"category": "400", "kamis_name": "사과", "kind_contains": "후지", "scale": 0.1},
    "배": {"category": "400", "kamis_name": "배", "kind_contains": None, "scale": 0.1},
    "감귤": {"category": "400", "kamis_name": "감귤", "kind_contains": None, "scale": 0.1},
    "감": {"category": "400", "kamis_name": "감", "kind_contains": None, "scale": 0.1},
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
                by_rank[it.get("rank")] = round(int(raw) * cfg["scale"])
            except ValueError:
                continue
        if by_rank:
            prices[item_name] = by_rank
    return prices


def get_public_price(item_name: str, grade_kor: str) -> "int | None":
    """오늘(없으면 최근 영업일) KAMIS 소매가격에서 등급에 맞는 가격을 원 단위로 반환.
    데이터가 없으면(휴장일, 비계절 품목, 인증키 미설정, API 실패 등) None —
    호출부는 이 경우 기존 정적 PUBLIC_PRICE_MAP으로 폴백해야 한다.
    """
    today = date.today()
    if _cache["date"] != today:
        prices = {}
        for days_back in range(5):
            regday = (today - timedelta(days=days_back)).isoformat()
            prices = _build_prices_for_date(regday)
            if prices:
                break
        _cache["date"] = today
        _cache["prices"] = prices

    by_rank = _cache["prices"].get(item_name)
    if not by_rank:
        return None
    rank = GRADE_TO_RANK.get(grade_kor, "상품")
    if rank in by_rank:
        return by_rank[rank]
    # 감귤처럼 상품/중품이 아니라 크기 등급(M과/S과 등)만 있는 경우 아무 값이나 대표로 사용
    return next(iter(by_rank.values()))
