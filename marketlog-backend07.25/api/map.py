import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models import Market, Product, Store

router = APIRouter(prefix="/api/v1/map", tags=["map"])

GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"
REVERSE_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc"

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


# 1.6. 좌표 → 주소 (역지오코딩) — AI 스캔 후 저장목록에 "몇 시에 어디서 스캔했는지"
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
            params={"coords": f"{lng},{lat}", "orders": "admcode", "output": "json"},
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
        return {"status": "success", "label": ""}

    region = results[0].get("region", {})
    # area1=시/도, area2=시/군/구, area3=읍/면/동 — 정확한 지번까지는 필요 없고
    # (오히려 노출 안 하는 게 나음) 구/동 단위 라벨이면 충분하다.
    label = " ".join(
        filter(None, [
            region.get("area1", {}).get("name", ""),
            region.get("area2", {}).get("name", ""),
            region.get("area3", {}).get("name", ""),
        ])
    )
    return {"status": "success", "label": label}


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
                "products": products_by_store.get(s.id, []),
            }
            for s in stores
        ],
    }


# 3. 상품 상세 화면의 "매장 정보" 탭 등에서, 지도 핀 목적의 필터링 없이 점포 하나의
# 실제 정보(주요품목/전화/영업시간/골목/소개)만 조회할 때 쓴다. 못 찾으면 store: null —
# 아직 지도에 위치를 등록하지 않은 상인일 수 있으므로, 프론트가 "정보 없음"으로 처리한다.
@router.get("/store")
def get_store_by_name(name: str, db: Session = Depends(get_db)):
    store = db.query(Store).filter(Store.market_id == DEFAULT_MARKET_ID, Store.name == name).first()
    if not store:
        return {"status": "success", "store": None}
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
        },
    }
