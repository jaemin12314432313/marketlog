"""KAMIS(농산물유통정보) Open API 연동 — 품목 인식 모델의 실제 10개 클래스에 대한
소매가격을 조회한다. dailyPriceByCategoryList는 카테고리 전체를 한 번에 반환하므로
날짜당 한 번만 호출해 메모리에 캐시한다.
"""
from __future__ import annotations

import asyncio
import os
import ssl
import threading
from datetime import date, datetime, timedelta

import httpx

KAMIS_BASE_URL = "https://www.kamis.or.kr/service/price/xml.do"
# KAMIS는 http/기본 User-Agent로는 연결을 리셋시키고 https + 브라우저 UA에서만 응답한다.
KAMIS_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

# python:3.12-slim(Debian) 컨테이너의 OpenSSL 3.0 기본 보안 레벨(SECLEVEL=2)은
# KAMIS 서버가 쓰는 구형 TLS 설정을 거부해 SSLV3_ALERT_HANDSHAKE_FAILURE로 매번
# 핸드셰이크가 실패한다 — 로컬 Windows(다른 OpenSSL 빌드)에서는 재현되지 않았던
# 이유이기도 하다. SECLEVEL=1로 낮춰서 KAMIS 호출에만 예외를 둔다.
_KAMIS_SSL_CONTEXT = ssl.create_default_context()
_KAMIS_SSL_CONTEXT.set_ciphers("DEFAULT@SECLEVEL=1")

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
# SCAN_MOCK 경로는 3단계(특/상/보통), mlv2 실측 스캔의 옛 그레이더는 2단계(특상/보통),
# attribute_quality_v3(2026-08-18~)는 3단계(상/중/하)를 쓰므로 전부 매핑해 둔다.
# "하"는 KAMIS에 대응 등급이 없어 둘 중 낮은 "중품"으로 근사한다.
GRADE_TO_RANK = {"특": "상품", "상": "상품", "특상": "상품", "보통": "중품", "중": "중품", "하": "중품"}

_cache: dict = {"date": None, "regday": None, "prices": {}, "retry_after": None}
_RETRY_COOLDOWN = timedelta(minutes=5)
# KAMIS가 당일 데이터를 아직 안 올려서 며칠 전 걸로 대체했을 때, 그걸 "오늘치 완료"로
# 착각하고 자정까지 안 쳐다보면 실제로는 최신 데이터가 낮/오후에 올라와도 하루 종일
# 오래된 가격을 보여주게 된다. 이런 경우엔 짧게(1시간) 쉬었다가 다시 확인한다.
_STALE_DATA_RECHECK_COOLDOWN = timedelta(hours=1)
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
            verify=_KAMIS_SSL_CONTEXT,
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
    today_iso = today.isoformat()
    prices: dict = {}
    regday_used: "str | None" = None
    had_failure = False
    for days_back in range(5):
        regday = (today - timedelta(days=days_back)).isoformat()
        prices, ok = _build_prices_for_date(regday)
        had_failure = had_failure or not ok
        if prices:
            regday_used = regday
            break
    _cache["prices"] = prices
    _cache["regday"] = regday_used
    if had_failure:
        # 일시적 실패 — 오늘 날짜로 확정 짓지 않고, 쿨다운 후 같은 날 안에도 다시 시도한다.
        _cache["date"] = None
        _cache["retry_after"] = datetime.now() + _RETRY_COOLDOWN
    elif regday_used == today_iso:
        # 오늘자 데이터를 실제로 받았다 — 내일까지는 다시 확인할 필요 없음.
        _cache["date"] = today
        _cache["retry_after"] = None
    else:
        # 실패는 아니지만 오늘자 데이터가 아직 없어서 예전 날짜로 대체했다 — "오늘치
        # 완료"로 착각해 자정까지 방치하면 안 되므로 stale로 남겨두고 짧게 재확인한다.
        _cache["date"] = None
        _cache["retry_after"] = datetime.now() + _STALE_DATA_RECHECK_COOLDOWN


async def auto_refresh_loop() -> None:
    """서버 기동 시 즉시 한 번 갱신하고, 이후 매일 자정마다 자동으로 다시 받아온다.
    Cloud Run은 기본적으로 요청을 처리하는 동안에만 CPU를 배정하므로(cpu-throttling),
    이 루프가 asyncio.create_task로 떠서 백그라운드로만 도는 동안엔 사실상 멈춰있을 수
    있다 — 그래서 실제로 캐시가 채워지는 걸 보장하는 건 이 루프가 아니라 아래
    get_public_price()가 요청 처리 도중 직접 기다리는 ensure_fresh()다. 이 루프는 운
    좋게 먼저 끝나면 캐시를 미리 데워두는 최선노력용이다."""
    while True:
        await asyncio.to_thread(_refresh_cache)
        tomorrow = datetime.combine(date.today() + timedelta(days=1), datetime.min.time())
        await asyncio.sleep((tomorrow - datetime.now()).total_seconds())


def _refresh_cache_locked() -> None:
    with _refresh_lock:
        _refresh_cache()


async def ensure_fresh(timeout: float = 25.0) -> None:
    """캐시가 오늘 날짜로 갱신돼 있는지 확인하고, 아니면 실제로 끝날 때까지(제한 시간
    안에서) 기다린다. 예전엔 별도 스레드를 "띄우기만" 하고 이번 요청은 기다리지 않고
    바로 넘어갔는데 — Cloud Run이 요청 처리 중에만 CPU를 주는 환경이라, 응답이 나간
    뒤에는 그 백그라운드 스레드가 사실상 멈춰버려서 캐시가 영영 안 채워지는 문제가
    있었다(공공시세가 항상 "데이터 없음"으로만 나오던 원인). 지금 요청의 실행 시간
    안에서 await로 직접 기다려야 실제로 CPU를 받아 끝까지 실행된다.
    """
    is_stale = _cache["date"] != date.today()
    cooldown_elapsed = _cache["retry_after"] is None or datetime.now() >= _cache["retry_after"]
    if not (is_stale and cooldown_elapsed):
        return

    if _refresh_lock.locked():
        # 동시에 들어온 다른 요청이 이미 갱신 중 — 짧게만 같이 기다렸다가, 안 끝나도
        # 지금 있는 캐시로 그냥 진행한다(이 요청까지 무한정 묶어두지 않는다).
        waited = 0.0
        while _refresh_lock.locked() and waited < timeout:
            await asyncio.sleep(0.3)
            waited += 0.3
        return

    try:
        await asyncio.wait_for(asyncio.to_thread(_refresh_cache_locked), timeout=timeout)
    except asyncio.TimeoutError:
        pass  # 제한 시간 안에 못 끝나면 지금 있는 캐시(비어있으면 폴백 대상)로 그냥 진행


async def get_public_price(item_name: str, grade_kor: str) -> "int | None":
    """오늘(없으면 최근 영업일) KAMIS 소매가격에서 등급에 맞는 가격을 원/kg 단위로 반환.
    데이터가 없으면(휴장일, 비계절 품목, 인증키 미설정, API 실패, 시간 안에 못 받아옴 등)
    None — 호출부는 이 경우 기존 정적 PUBLIC_PRICE_MAP으로 폴백해야 한다.
    """
    await ensure_fresh()

    by_rank = _cache["prices"].get(item_name)
    if not by_rank:
        return None
    rank = GRADE_TO_RANK.get(grade_kor, "상품")
    if rank in by_rank:
        return by_rank[rank]
    # 감귤처럼 상품/중품이 아니라 크기 등급(M과/S과 등)만 있는 경우 아무 값이나 대표로 사용
    return next(iter(by_rank.values()))
