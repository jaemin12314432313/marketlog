import os
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/api/v1/map", tags=["map"])

# 1. 네이버 지도 Client ID 등 환경설정 전달
@router.get("/config")
def get_map_config():
    return {
        "status": "success",
        "naver_client_id": os.getenv("NAVER_CLIENT_ID", "ye958r8a36")
    }

# 2. 지도 중심 좌표 및 점포 핀(Marker) 데이터 전달 (백엔드 중심 데이터)
@router.get("/stores")
def get_map_stores(market_name: str = "양동시장"):
    # 백엔드 DB 또는 AI 연동 데이터 (추후 DB에서 가져오도록 자유롭게 변경 가능)
    # 실제 광주 양동시장 부지 내 좌표 (OpenStreetMap 기준, 천변좌로 238 인근).
    # 이전 값(35.1542, 126.8971)은 실제 시장보다 약 500m 서쪽 돌고개 인근을 가리키고 있어 수정함.
    stores = [
        {
            "id": "store_1",
            "name": "양동수산",
            "subtitle": "특대 은갈치",
            "lat": 35.1537,
            "lng": 126.9038,
            "category": "fish",
            "icon": "set_meal",
            "badge_color": "#3B82F6",  # trust-blue
            "grade": "A+",
            "notice": "오늘 들어온 활어 세일중!",
            "notice_time": "새소식 2시간 전",
            "alley": "수산물 골목"
        },
        {
            "id": "store_2",
            "name": "호남상회",
            "subtitle": "가을무",
            "lat": 35.1528,
            "lng": 126.9022,
            "category": "vegetable",
            "icon": "eco",
            "badge_color": "#10B981",  # safe-emerald
            "grade": "A",
            "notice": "가을무 20% OFF 쿠폰",
            "notice_time": "퀘스트 연관 추천 (50m)",
            "alley": "야채 채소 골목"
        },
        {
            "id": "store_3",
            "name": "상록회관",
            "subtitle": "잡화/청과",
            "lat": 35.1526,
            "lng": 126.9033,
            "category": "store",
            "icon": "storefront",
            "badge_color": "#F59E0B",  # caution-amber
            "grade": "B",
            "notice": "신선한 과일 입고",
            "notice_time": "1시간 전",
            "alley": "잡화 골목"
        }
    ]

    return {
        "status": "success",
        "market_name": market_name,
        "center": {"lat": 35.1531, "lng": 126.9028},
        "stores": stores
    }