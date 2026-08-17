import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models import Market, Product, Store

router = APIRouter(prefix="/api/v1/map", tags=["map"])

GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"
REVERSE_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc"
# 이건 위 지오코딩(NCP Maps)이랑 완전히 다른 서비스다 — NAVER API HUB(console.ncloud.com)
# 에서 별도로 신청하는 "검색 > 지역" 이고, 인증 키도 NAVER_SEARCH_CLIENT_ID/SECRET로
# 따로 받는다. 주소 문자열이 아니라 "양동시장" 같은 상호/장소명으로 검색할 수 있는 게
# 이 API만의 기능이라 지오코딩으로 대체가 안 된다.
# 예전 openapi.naver.com/v1/search/local.json 엔드포인트는 API HUB로 이관되면서 경로와
# 인증 헤더(X-Naver-Client-Id → X-NCP-APIGW-API-KEY-ID)가 통째로 바뀌었다.
LOCAL_SEARCH_URL = "https://naverapihub.apigw.ntruss.com/search/v1/local"

DEFAULT_MARKET_ID = "yangdong"

# 지도가 너무 빽빽해지는 일반 도소매/소매 점포는 지도 핀에서는 제외 (DB에는 그대로 유지).
MAP_EXCLUDED_CATEGORIES = ["store"]


# 1. 네이버 지도 Client ID 등 환경설정 전달
@router.get("/config")
def get_map_config():
    return {
        "status": "success",
        "naver_client_id": os.getenv("NAVER_CLIENT_ID", "ye958r8a36")
    }


# 1.5. 주소 → 좌표 검색 (지오코딩) — 프론트에서 naver.maps.Service.geocode()를 직접
# 쓰면 브라우저 쪽 Client ID(비밀키 없음) 인증으로는 이 계정에서 동작하지 않아서
# (naver.maps.Service 자체가 안 붙음, 콘솔엔 API가 등록돼 있어도 발생 가능), 비밀키가
# 필요한 서버사이드 REST 지오코딩을 백엔드에서 대신 호출해 프록시한다.
@router.get("/geocode")
def geocode_address(query: str):
    client_id = os.getenv("NAVER_CLIENT_ID")
    client_secret = os.getenv("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="네이버 지도 인증 정보가 서버에 설정되어 있지 않습니다.")

    try:
        resp = httpx.get(
            GEOCODE_URL,
            params={"query": query},
            headers={
                "x-ncp-apigw-api-key-id": client_id,
                "x-ncp-apigw-api-key": client_secret,
            },
            timeout=10,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"네이버 지오코딩 서버 호출에 실패했습니다: {e}")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"네이버 지오코딩 API 오류 (status={resp.status_code}): {resp.text[:200]}")

    data = resp.json()
    addresses = data.get("addresses", [])
    return {
        "status": "success",
        "addresses": [
            {
                "roadAddress": a.get("roadAddress", ""),
                "jibunAddress": a.get("jibunAddress", ""),
                "lat": float(a["y"]),
                "lng": float(a["x"]),
            }
            for a in addresses
        ],
    }


def _parse_local_search_coord(raw: str) -> float:
    """mapx/mapy는 정수 문자열로 온다. 네이버가 2024-11-17부터 이 값의 좌표계를
    KATECH에서 WGS84로 바꿨는데, 스케일(예: 1e7배 정수인지)이 문서마다 다르게
    적혀 있어 확실치 않다 — 그래서 값 범위를 보고 방어적으로 판단한다. 위도/경도는
    -180~180을 못 넘으므로, 그보다 훨씬 큰 정수면 1e7로 나눈 값으로 취급한다.
    """
    value = float(raw)
    if abs(value) > 180:
        value = value / 1e7
    return value


# 1.6. 상호명/장소명 검색 — 지오코딩(주소 문자열 전용)과 달리 "양동시장"처럼 정확한
# 주소를 모르는 장소명으로도 찾을 수 있다. NAVER API HUB에서 별도 신청한
# NAVER_SEARCH_CLIENT_ID/SECRET을 쓴다(지도용 NAVER_CLIENT_ID/SECRET과는 다른 키,
# 인증 헤더도 NCP APIGW 방식이라 지오코딩과 동일한 x-ncp-apigw-api-key 계열이다).
@router.get("/search-place")
def search_place(query: str):
    client_id = os.getenv("NAVER_SEARCH_CLIENT_ID")
    client_secret = os.getenv("NAVER_SEARCH_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="네이버 검색 API 인증 정보가 서버에 설정되어 있지 않습니다.")

    try:
        resp = httpx.get(
            LOCAL_SEARCH_URL,
            params={"query": query, "display": 5, "sort": "random"},
            headers={
                "X-NCP-APIGW-API-KEY-ID": client_id,
                "X-NCP-APIGW-API-KEY": client_secret,
            },
            timeout=10,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"네이버 지역 검색 서버 호출에 실패했습니다: {e}")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"네이버 지역 검색 API 오류 (status={resp.status_code}): {resp.text[:200]}")

    data = resp.json()
    items = data.get("items", [])
    return {
        "status": "success",
        "places": [
            {
                # title엔 검색어와 일치하는 부분에 <b> 태그가 섞여 온다 — 화면에 그대로
                # 보여줄 거면 태그를 지운다.
                "name": item.get("title", "").replace("<b>", "").replace("</b>", ""),
                "category": item.get("category", ""),
                "roadAddress": item.get("roadAddress", ""),
                "jibunAddress": item.get("address", ""),
                "lat": _parse_local_search_coord(item.get("mapy", "0")),
                "lng": _parse_local_search_coord(item.get("mapx", "0")),
            }
            for item in items
        ],
    }


# 1.7. 좌표 → 주소 (역지오코딩) — AI 스캔 후 저장목록에 "몇 시에 어디서 스캔했는지"
# 표시하려고 쓴다. 얘도 geocode와 같은 이유(클라이언트 사이드 naver.maps.Service가 이
# 계정에서 안 붙음)로 프론트에서 직접 못 부르길래, 여기서 서버사이드 REST로 대신한다.
@router.get("/reverse-geocode")
def reverse_geocode(lat: float, lng: float):
    client_id = os.getenv("NAVER_CLIENT_ID")
    client_secret = os.getenv("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="네이버 지도 인증 정보가 서버에 설정되어 있지 않습니다.")

    try:
        resp = httpx.get(
            REVERSE_GEOCODE_URL,
            # admcode=구/동 단위 라벨(스캔 위치 표시용), roadaddr=도로명 주소(점포 위치
            # 등록에서 지도 클릭 시 자동으로 채워주는 용도) — 한 번에 같이 받는다.
            params={"coords": f"{lng},{lat}", "orders": "admcode,roadaddr", "output": "json"},
            headers={
                "x-ncp-apigw-api-key-id": client_id,
                "x-ncp-apigw-api-key": client_secret,
            },
            timeout=10,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"네이버 역지오코딩 서버 호출에 실패했습니다: {e}")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"네이버 역지오코딩 API 오류 (status={resp.status_code}): {resp.text[:200]}")

    data = resp.json()
    results = data.get("results", [])
    if not results:
        return {"status": "success", "label": "", "roadAddress": ""}

    label = ""
    road_address = ""
    for r in results:
        region = r.get("region", {})
        if r.get("name") == "admcode":
            # area1=시/도, area2=시/군/구, area3=읍/면/동 — 정확한 지번까지는 필요 없고
            # (오히려 노출 안 하는 게 나음) 구/동 단위 라벨이면 충분하다.
            label = " ".join(
                filter(None, [
                    region.get("area1", {}).get("name", ""),
                    region.get("area2", {}).get("name", ""),
                    region.get("area3", {}).get("name", ""),
                ])
            )
        elif r.get("name") == "roadaddr":
            land = r.get("land", {})
            road_name = land.get("name", "")
            number1 = land.get("number1", "")
            number2 = land.get("number2", "")
            building_number = f"{number1}-{number2}" if number2 else number1
            road_address = " ".join(
                filter(None, [
                    region.get("area1", {}).get("name", ""),
                    region.get("area2", {}).get("name", ""),
                    region.get("area3", {}).get("name", ""),
                    road_name,
                    building_number,
                ])
            )

    return {"status": "success", "label": label, "roadAddress": road_address}


# 2. 지도 중심 좌표 및 점포 핀(Marker) 데이터 전달 (DB 기반)
@router.get("/stores")
def get_map_stores(market_name: str = "양동시장", db: Session = Depends(get_db)):
    market = db.query(Market).filter(Market.name == market_name).first()
    if not market:
        market = db.query(Market).filter(Market.id == DEFAULT_MARKET_ID).first()

    stores = (
        db.query(Store)
        .filter(Store.market_id == market.id, Store.category.notin_(MAP_EXCLUDED_CATEGORIES))
        .all()
        if market
        else []
    )

    # 점포에 연결된 상인 등록 상품 (있으면 핀에 같이 표시할 수 있도록)
    store_ids = [s.id for s in stores]
    products_by_store: dict = {}
    if store_ids:
        for p in db.query(Product).filter(Product.store_id.in_(store_ids)).all():
            products_by_store.setdefault(p.store_id, []).append(
                {"id": p.id, "title": p.title, "price": p.price, "image_url": p.image_url}
            )

    return {
        "status": "success",
        "market_name": market.name if market else market_name,
        "center": {
            "lat": market.center_lat if market else 0.0,
            "lng": market.center_lng if market else 0.0,
        },
        "stores": [
            {
                "id": s.id,
                "name": s.name,
                "subtitle": s.subtitle,
                "lat": s.lat,
                "lng": s.lng,
                "category": s.category,
                "icon": s.icon,
                "badge_color": s.badge_color,
                "grade": s.grade,
                "notice": s.notice,
                "notice_time": s.notice_time,
                "alley": s.alley,
                "phone": s.phone,
                "hours": s.hours,
                "address": s.address,
                "products": products_by_store.get(s.id, []),
            }
            for s in stores
        ],
    }


# 3. 상품 상세 화면의 "매장 정보" 탭 등에서, 지도 핀 목적의 필터링 없이 점포 하나의
# 실제 정보(주요품목/전화/영업시간/골목/소개)만 조회할 때 쓴다. 못 찾으면 store: null —
# 아직 지도에 위치를 등록하지 않은 상인일 수 있으므로, 프론트가 "정보 없음"으로 처리한다.
#
# market_id를 무조건 DEFAULT_MARKET_ID("yangdong")로 고정해뒀던 예전 코드는, 다른
# 시장(망원/자갈치/직접입력 등) 소속 상인의 점포는 여기서 아예 못 찾아서 상인이 마이
# 탭에서 저장한 전화/영업시간/주요품목이 소비자 화면에는 전부 "정보 없음"으로 보이는
# 버그가 있었다. product.marketId를 프론트에서 넘겨주면 그 시장으로 좁혀서 찾고,
# 없으면(예전 클라이언트 등) 시장 제한 없이 이름만으로 찾는다.
@router.get("/store")
def get_store_by_name(name: str, market_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(Store).filter(Store.name == name)
    if market_id:
        query = query.filter(Store.market_id == market_id)
    store = query.first()
    if not store:
        return {"status": "success", "store": None}
    # 소속 전통시장은 product.marketId(상품 생성 시점에 박제된 값)가 아니라 Store.market_id
    # 기준으로 매번 새로 찾는다 — 상인이 나중에 마이 탭에서 시장을 바꿔도 Store 행은 그
    # 즉시 갱신되지만, 예전에 등록된 Product 행의 marketId는 그대로 남아있어서(재등록 전엔
    # 안 바뀜) 그걸 기준으로 하면 전화번호/영업시간처럼 실시간으로 안 바뀌고 계속 옛 시장이
    # 보이는 문제가 있었다.
    market = db.query(Market).filter(Market.id == store.market_id).first()
    return {
        "status": "success",
        "store": {
            "name": store.name,
            "subtitle": store.subtitle,
            "category": store.category,
            "alley": store.alley,
            "phone": store.phone,
            "hours": store.hours,
            "storyText": store.story_text,
            "address": store.address,
            "marketName": market.name if market else "",
        },
    }
