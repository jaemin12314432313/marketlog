"""KAMIS(농산물유통정보) Open API 연동 — 품목 인식 모델의 실제 10개 클래스에 대한
소매가격을 조회한다. dailyPriceByCategoryList는 카테고리 전체를 한 번에 반환하므로
날짜당 한 번만 호출해 메모리에 캐시한다.
"""
from __future__ import annotations

import asyncio
import os
import threading
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

# 등급 -> KAMIS 소매가격의 2단계 등급(상품/중품) 근사 매핑.
# KAMIS 소매가는 상품(고급)/중품(중급) 두 단계만 제공해서 완전히 대응되진 않는다.
# SCAN_MOCK 경로는 여전히 3단계(특/상/보통)를 쓰고, mlv2 실측 스캔 경로는 2단계
# (특상/보통)를 쓰므로 둘 다 매핑해 둔다.
GRADE_TO_RANK = {"특": "상품", "상": "상품", "특상": "상품", "보통": "중품"}

_cache: dict = {"date": None, "prices": {}, "retry_after": None}
_RETRY_COOLDOWN = timedelta(minutes=5)
_refresh_lock = threading.Lock()


def _fetch_category(category: str, regday: str) -> "tuple[list, bool]":
    """반환값의 두 번째 항목(ok)은 '호출이 정상적으로 응답을 받았는지'를 뜻한다.
    네트워크/타임아웃 등 일시적 실패와 '정상 응답이지만 데이터가 없음'을 구분해야,
    일시적 실패일 때만 재시도하고 진짜 휴장일 등은 하루치로 캐싱할 수 있다.
    """
    cert_key = os.getenv("KAMIS_CERT_KEY")
    cert_id = os.getenv("KAMIS_CERT_ID")
    if not cert_key or not cert_id:
        return [], True  # 설정 자체가 없는 건 재시도해도 달라지지 않음
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
            return data.get("item", []), True
        return [], True
    except Exception as e:
        print(f"KAMIS API 호출 실패 (category={category}, regday={regday}): {e}")
        return [], False


def _build_prices_for_date(regday: str) -> "tuple[dict, bool]":
    categories = {cfg["category"] for cfg in ITEM_CONFIG.values()}
    items_by_category: dict = {}
    all_ok = True
    for cat in categories:
        items, ok = _fetch_category(cat, regday)
        items_by_category[cat] = items
        all_ok = all_ok and ok

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
    return prices, all_ok


def _refresh_cache() -> None:
    today = date.today()
    prices: dict = {}
    had_failure = False
    for days_back in range(5):
        regday = (today - timedelta(days=days_back)).isoformat()
        prices, ok = _build_prices_for_date(regday)
        had_failure = had_failure or not ok
        if prices:
            break
    _cache["prices"] = prices
    if had_failure:
        # 일시적 실패 — 오늘 날짜로 확정 짓지 않고, 쿨다운 후 같은 날 안에도 다시 시도한다.
        _cache["date"] = None
        _cache["retry_after"] = datetime.now() + _RETRY_COOLDOWN
    else:
        _cache["date"] = today
        _cache["retry_after"] = None


async def auto_refresh_loop() -> None:
    """서버 기동 시 즉시 한 번 갱신하고, 이후 매일 자정마다 자동으로 다시 받아온다.
    사용자 요청이 없어도 캐시가 그날 데이터로 미리 채워진다."""
    while True:
        await asyncio.to_thread(_refresh_cache)
        tomorrow = datetime.combine(date.today() + timedelta(days=1), datetime.min.time())
        await asyncio.sleep((tomorrow - datetime.now()).total_seconds())


def _trigger_background_refresh() -> None:
    """캐시 갱신은 최대 5일치 x 3개 카테고리까지 KAMIS를 순차 호출할 수 있어 느릴 때는
    수십 초까지 걸린다. get_public_price()가 이걸 그 자리에서 기다리면(특히
    analyze_product 같은 async 핸들러 안에서 await 없이 호출되므로) 그 동안 이벤트 루프
    전체가 멈춰 다른 모든 요청까지 같이 느려진다. 그래서 별도 스레드에서 갱신하고, 이번
    요청은 갱신 중인 기존 캐시(비어 있으면 None → 호출부가 정적 가격으로 폴백)를 그대로 쓴다.
    이미 갱신 중이면 새 스레드를 또 띄우지 않는다."""
    if _refresh_lock.locked():
        return

    def _run() -> None:
        with _refresh_lock:
            _refresh_cache()

    threading.Thread(target=_run, daemon=True).start()


def get_public_price(item_name: str, grade_kor: str) -> "int | None":
    """오늘(없으면 최근 영업일) KAMIS 소매가격에서 등급에 맞는 가격을 원/kg 단위로 반환.
    데이터가 없으면(휴장일, 비계절 품목, 인증키 미설정, API 실패, 갱신 진행 중 등) None —
    호출부는 이 경우 기존 정적 PUBLIC_PRICE_MAP으로 폴백해야 한다.
    """
    is_stale = _cache["date"] != date.today()
    cooldown_elapsed = _cache["retry_after"] is None or datetime.now() >= _cache["retry_after"]
    if is_stale and cooldown_elapsed:
        _trigger_background_refresh()

    by_rank = _cache["prices"].get(item_name)
    if not by_rank:
        return None
    rank = GRADE_TO_RANK.get(grade_kor, "상품")
    if rank in by_rank:
        return by_rank[rank]
    # 감귤처럼 상품/중품이 아니라 크기 등급(M과/S과 등)만 있는 경우 아무 값이나 대표로 사용
    return next(iter(by_rank.values()))
