import os
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db import get_db
from models import Market, Store

router = APIRouter(prefix="/api/v1/map", tags=["map"])

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
            }
            for s in stores
        ],
    }
