from sqlalchemy.orm import Session

from models import Market, Store, Product
from gwangju_market_data import load_yangdong_stores

MARKETS = [
    {
        "id": "yangdong",
        "name": "광주 양동시장",
        "city": "광주광역시 서구",
        "congestion": "원활",
        "parking_capacity": "24/80면 여유 (양동 공영주차장)",
        "toilet_location": "수산동 2층 / B동 중앙출입구",
        "docent_story_title": "양동시장 수산길 이야기",
        "docent_script": (
            "\"오른쪽에 보이는 양동수산은 매일 새벽 산지에서 직송된 신선한 활어를 취급합니다. "
            "오늘 A급 갈치와 싱싱한 가을무의 환상적인 조합을 경험해보세요!\""
        ),
        "audio_duration": "03:45",
        "center_lat": 35.1531,
        "center_lng": 126.9028,
    },
    {
        "id": "mangwon",
        "name": "서울 망원시장",
        "city": "서울특별시 마포구",
        "congestion": "보통",
        "parking_capacity": "12/50면 여유 (망원1동 노상주차장)",
        "toilet_location": "고객만족센터 1층",
        "docent_story_title": "망원시장 먹거리 골목 레전드",
        "docent_script": (
            "\"망원시장의 유서 깊은 맛집들과 신선한 제철 농산물 코너입니다. "
            "AI 신뢰 뱃지가 적용된 착한가격업소를 만나보세요.\""
        ),
        "audio_duration": "02:50",
        "center_lat": 37.5563,
        "center_lng": 126.9013,
    },
    {
        "id": "jagalchi",
        "name": "부산 자갈치시장",
        "city": "부산광역시 중구",
        "congestion": "혼잡",
        "parking_capacity": "5/120면 (건물 지하주차장)",
        "toilet_location": "본관 1층, 3층",
        "docent_story_title": "자갈치 싱싱 수산 해설",
        "docent_script": (
            "\"부산 앞바다에서 방금 올려낸 남해안 은갈치와 전복의 AI 등급 검증 정보를 "
            "확인하고 안심하고 구매하세요.\""
        ),
        "audio_duration": "04:10",
        "center_lat": 35.0967,
        "center_lng": 129.0306,
    },
]

# 양동시장 실 점포 데이터 (광주광역시 전통시장 점포 현황 공공데이터, 2021-11-19 기준)
YANGDONG_STORES = load_yangdong_stores()

# 상품 피드 시드 — 품목 인식 모델이 실제로 학습한 10개 클래스
# (무·배추·양파·마늘·양배추·감·사과·배·감귤·감자) 기준으로 구성.
SEED_PRODUCTS = [
    {
        "id": "prod-1",
        "market_id": "yangdong",
        "region": "광주광역시",
        "title": "국내산 가을무 1단",
        "shop_name": "호남상회",
        "distance": "800m",
        "time_ago": "방금 전",
        "price": 3200,
        "public_price": 3500,
        "price_tag": "공공 시세 대비 9% 저렴",
        "grade": "A+",
        "category": "신선야채",
        "image_url": "https://plus.unsplash.com/premium_photo-1726736510146-4703a18e3c6e?auto=format&fit=crop&w=800&q=80",
        "freshness_score": 96,
        "defect_score": 94,
        "uniformity_score": 93,
        "description": "표면이 매끈하고 무름 없이 단단하여 신선도가 우수한 무입니다.",
        "is_merchant_uploaded": False,
    },
    {
        "id": "prod-2",
        "market_id": "yangdong",
        "region": "광주광역시",
        "title": "알배기 배추 1포기",
        "shop_name": "호남상회",
        "distance": "800m",
        "time_ago": "10분 전",
        "price": 4500,
        "public_price": 5000,
        "price_tag": "공공 시세 대비 10% 저렴",
        "grade": "A",
        "category": "신선야채",
        "image_url": "https://images.unsplash.com/photo-1779738192854-92a3daec9b45?auto=format&fit=crop&w=800&q=80",
        "freshness_score": 93,
        "defect_score": 90,
        "uniformity_score": 91,
        "description": "속이 꽉 차고 겉잎 손상이 적은 신선한 알배기 배추입니다.",
        "is_merchant_uploaded": False,
    },
    {
        "id": "prod-3",
        "market_id": "yangdong",
        "region": "광주광역시",
        "title": "국내산 수미 감자 2kg",
        "shop_name": "호남상회",
        "distance": "800m",
        "time_ago": "방금 전",
        "price": 3600,
        "public_price": 4000,
        "price_tag": "공공 시세 대비 10% 저렴",
        "grade": "B+",
        "category": "신선야채",
        "image_url": "https://plus.unsplash.com/premium_photo-1724256031338-b5bfba816cfd?auto=format&fit=crop&w=800&q=80",
        "freshness_score": 90,
        "defect_score": 87,
        "uniformity_score": 89,
        "description": "크기가 고르고 싹이 나지 않은 양호한 상태의 감자입니다.",
        "is_merchant_uploaded": False,
    },
    {
        "id": "prod-4",
        "market_id": "yangdong",
        "region": "광주광역시",
        "title": "청송 부사 사과 5개입",
        "shop_name": "싱싱청과",
        "distance": "1.2km",
        "time_ago": "10분 전",
        "price": 13500,
        "public_price": 15000,
        "price_tag": "공공 시세 대비 10% 저렴",
        "grade": "A",
        "category": "과일",
        "image_url": "https://plus.unsplash.com/premium_photo-1724249990837-f6dfcb7f3eaa?auto=format&fit=crop&w=800&q=80",
        "freshness_score": 94,
        "defect_score": 92,
        "uniformity_score": 91,
        "description": "당도가 높고 표면 흠집이 거의 없는 우수한 사과입니다.",
        "is_merchant_uploaded": False,
    },
    {
        "id": "prod-5",
        "market_id": "yangdong",
        "region": "광주광역시",
        "title": "노지 감귤 1kg",
        "shop_name": "싱싱청과",
        "distance": "1.2km",
        "time_ago": "방금 전",
        "price": 7000,
        "public_price": 8000,
        "price_tag": "공공 시세 대비 13% 저렴",
        "grade": "A",
        "category": "과일",
        "image_url": "https://images.unsplash.com/photo-1557800636-894a64c1696f?auto=format&fit=crop&w=800&q=80",
        "freshness_score": 92,
        "defect_score": 90,
        "uniformity_score": 90,
        "description": "당도가 균일하고 껍질에 상처가 없는 노지 감귤입니다.",
        "is_merchant_uploaded": False,
    },
]


def seed_if_empty(db: Session) -> None:
    if db.query(Market).count() == 0:
        for m in MARKETS:
            db.add(Market(**m))
        db.commit()

    if db.query(Store).count() == 0:
        for s in YANGDONG_STORES:
            db.add(Store(**s))
        db.commit()

    if db.query(Product).count() == 0:
        for p in SEED_PRODUCTS:
            db.add(Product(**p))
        db.commit()
