from sqlalchemy.orm import Session

from models import Market, Store, Product

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

# 양동시장 실 점포 데이터 (기존 api/map.py 하드코딩 값을 이전)
YANGDONG_STORES = [
    {
        "id": "store_1",
        "market_id": "yangdong",
        "name": "양동수산",
        "subtitle": "특대 은갈치",
        "lat": 35.1537,
        "lng": 126.9038,
        "category": "fish",
        "icon": "set_meal",
        "badge_color": "#3B82F6",
        "grade": "A+",
        "notice": "오늘 들어온 활어 세일중!",
        "notice_time": "새소식 2시간 전",
        "alley": "수산물 골목",
        "story_text": "양동수산은 30년 전통의 수산물 전문점으로, 매일 새벽 목포 위판장에서 직송된 신선한 활어를 취급합니다.",
    },
    {
        "id": "store_2",
        "market_id": "yangdong",
        "name": "호남상회",
        "subtitle": "가을무",
        "lat": 35.1528,
        "lng": 126.9022,
        "category": "vegetable",
        "icon": "eco",
        "badge_color": "#10B981",
        "grade": "A",
        "notice": "가을무 20% OFF 쿠폰",
        "notice_time": "퀘스트 연관 추천 (50m)",
        "alley": "야채 채소 골목",
        "story_text": "호남상회는 전남 나주 산지 직송 채소를 당일 공수하여 신선도를 보장하는 야채 전문점입니다.",
    },
    {
        "id": "store_3",
        "market_id": "yangdong",
        "name": "상록회관",
        "subtitle": "잡화/청과",
        "lat": 35.1526,
        "lng": 126.9033,
        "category": "store",
        "icon": "storefront",
        "badge_color": "#F59E0B",
        "grade": "B",
        "notice": "신선한 과일 입고",
        "notice_time": "1시간 전",
        "alley": "잡화 골목",
        "story_text": "상록회관은 전통시장의 오랜 역사와 함께한 신뢰할 수 있는 잡화·청과 매장입니다.",
    },
]

# 상품 피드 시드 (기존 api/consumer.py의 feed_db 초기값을 이전)
SEED_PRODUCTS = [
    {
        "id": "prod-1",
        "market_id": "yangdong",
        "region": "광주광역시",
        "title": "제주 은갈치 대자 2마리",
        "shop_name": "양동수산",
        "distance": "800m",
        "time_ago": "방금 전",
        "price": 18000,
        "public_price": 19500,
        "price_tag": "공공 시세 대비 10% 저렴",
        "grade": "A+",
        "category": "수산물",
        "image_url": "https://lh3.googleusercontent.com/aida-public/AB6AXuBPBsS9pCM36y_2W6Vey0_5EC88SbxJT0t7GhjPXTqlYnaqTLo0NcPV6LFPJH4p8pI2sVispE0SOUUZyXGM7sHnAfTR02l7Ecz_PaENAV0UotAJL_GFQ2-MlPFcyoWoDVhUhvNa5dMeWWVko5qNl4VottlwisP_V2H8J6BvPu4fkLyQ-lAczaPkDamw8VL1R4HpBabcEkOJK7MtMocMNcOhlDpmlg45ZYg8F7B_zr9m5nvPktBbJxjvUA",
        "freshness_score": 98,
        "defect_score": 95,
        "uniformity_score": 92,
        "description": "새벽 목포 수협 위판장에서 경매로 낙찰받아 즉송된 완도산 은갈치입니다.",
        "is_merchant_uploaded": False,
    },
    {
        "id": "prod-2",
        "market_id": "yangdong",
        "region": "광주광역시",
        "title": "논산 설향 딸기 500g",
        "shop_name": "싱싱청과",
        "distance": "1.2km",
        "time_ago": "10분 전",
        "price": 12500,
        "public_price": 13000,
        "price_tag": "시세와 비슷한 수준",
        "grade": "B+",
        "category": "과일",
        "image_url": "https://lh3.googleusercontent.com/aida-public/AB6AXuDPrTKft45sE79PKyzcNxkpR7jiC94SaLZBeIpOho8PS6MfxcM24FBq5mPUD-KQhGgWNaVSPodpYSrMEPgddi0FNoTIy5QByRJ1O29bN2GoPyZ_bHdyNd5oLvlWDvbU1IxCuntiDyiletIj2q2SHcDwhgzncBso0wtlMj6iVE_kmfeXMGwbx6c0QNetTRXhf0m91HziI7YK5e-OWXOgc84THY9rQc3IN9xQ2glKexbCJmw0SCF4BrhWOw",
        "freshness_score": 94,
        "defect_score": 92,
        "uniformity_score": 91,
        "description": "당도가 높아 과즙이 풍부하며 무름 현상이 없는 우수한 상품입니다.",
        "is_merchant_uploaded": False,
    },
    {
        "id": "prod-3",
        "market_id": "yangdong",
        "region": "광주광역시",
        "title": "한돈 삼겹살 600g (냉장)",
        "shop_name": "우리축산",
        "distance": "300m",
        "time_ago": "방금 전",
        "price": 16800,
        "public_price": 19800,
        "price_tag": "공공 시세 대비 15% 저렴",
        "grade": "A+",
        "category": "정육",
        "image_url": "https://lh3.googleusercontent.com/aida-public/AB6AXuDfqKKJROFYLfdHz4E-dhGPYRcjGFgyiVvPNDRmUVShw2Z2MABEaTDMc3Yh-oO77txFIhM4Fko4dPgwWTc4rYljeZnxkIfQcnrLP9JEOVhqXwiVmd5UxKDOBLXFugDB2zSgwLp4FR-guYiZtxriswvRdiFTkbxW2WcC9swB-xuvAG4kr3R3OIomDMdUDdfW0t8d2__fEnZGUFSVN-2Y6i8MIpXxpixAPZcIYGT2pHfzOSqTFdiVjw5Bfg",
        "freshness_score": 98,
        "defect_score": 96,
        "uniformity_score": 95,
        "description": "선홍빛 마블링이 우수하며 지방 비율이 매우 균일한 1등급 한돈입니다.",
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
