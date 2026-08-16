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

# 지역마다 실제로 잘 알려진 전통시장을 3곳씩 채운 목록 — 상인 가입 후 마이 탭에서
# "지역 선택 → 그 지역 시장 선택" 2단계로 고를 수 있게 한다. 도슨트 스크립트는 실제로
# 없는 점포 이야기를 지어내면 안 되므로 비워두고(요청 시 실제 점포 데이터로 동적 생성),
# 혼잡도/주차/화장실도 정확히 모르는 구체적 수치를 지어내지 않고 기본값으로 둔다.
EXTRA_MARKETS = [
    {"id": "daein", "name": "광주 대인시장", "city": "광주광역시 동구", "center_lat": 35.1476, "center_lng": 126.9241},
    {"id": "malbawi", "name": "광주 말바우시장", "city": "광주광역시 북구", "center_lat": 35.1789, "center_lng": 126.9186},
    {"id": "namdaemun", "name": "서울 남대문시장", "city": "서울특별시 중구", "center_lat": 37.5586, "center_lng": 126.9778},
    {"id": "gyeongdong", "name": "서울 경동시장", "city": "서울특별시 동대문구", "center_lat": 37.5776, "center_lng": 127.0378},
    {"id": "gukje", "name": "부산 국제시장", "city": "부산광역시 중구", "center_lat": 35.1004, "center_lng": 129.0293},
    {"id": "kkangtong", "name": "부산 부평깡통시장", "city": "부산광역시 중구", "center_lat": 35.1015, "center_lng": 129.0289},
    {"id": "seomun", "name": "대구 서문시장", "city": "대구광역시 중구", "center_lat": 35.8689, "center_lng": 128.5828},
    {"id": "chilseong", "name": "대구 칠성시장", "city": "대구광역시 북구", "center_lat": 35.8797, "center_lng": 128.5975},
    {"id": "gwanmun", "name": "대구 관문시장", "city": "대구광역시 북구", "center_lat": 35.8998, "center_lng": 128.5644},
    {"id": "sinpo", "name": "인천 신포국제시장", "city": "인천광역시 중구", "center_lat": 37.4707, "center_lng": 126.6350},
    {"id": "bupyeong", "name": "인천 부평시장", "city": "인천광역시 부평구", "center_lat": 37.4894, "center_lng": 126.7241},
    {"id": "sorae", "name": "인천 소래포구전통어시장", "city": "인천광역시 남동구", "center_lat": 37.3993, "center_lng": 126.7361},
    {"id": "daejeon-jungang", "name": "대전 중앙시장", "city": "대전광역시 동구", "center_lat": 36.3283, "center_lng": 127.4287},
    {"id": "yeokjeon", "name": "대전 역전시장", "city": "대전광역시 동구", "center_lat": 36.3315, "center_lng": 127.4344},
    {"id": "yuseong", "name": "대전 유성시장", "city": "대전광역시 유성구", "center_lat": 36.3622, "center_lng": 127.3435},
    {"id": "ulsan-jungang", "name": "울산 중앙시장", "city": "울산광역시 중구", "center_lat": 35.5691, "center_lng": 129.3298},
    {"id": "sinjeong", "name": "울산 신정시장", "city": "울산광역시 남구", "center_lat": 35.5462, "center_lng": 129.3168},
    {"id": "eonyang-alps", "name": "울산 언양알프스시장", "city": "울산광역시 울주군", "center_lat": 35.5657, "center_lng": 129.1178},
    {"id": "sejong-jochiwon", "name": "세종전통시장", "city": "세종특별자치시 조치원읍", "center_lat": 36.5975, "center_lng": 127.2967},
    {"id": "bugang", "name": "세종 부강전통시장", "city": "세종특별자치시 부강면", "center_lat": 36.5209, "center_lng": 127.3444},
    {"id": "jeonui", "name": "세종 전의전통시장", "city": "세종특별자치시 전의면", "center_lat": 36.6607, "center_lng": 127.2135},
    {"id": "moran", "name": "성남 모란시장", "city": "경기도 성남시 중원구", "center_lat": 37.4297, "center_lng": 127.1289},
    {"id": "suwon-nammun", "name": "수원 남문시장", "city": "경기도 수원시 팔달구", "center_lat": 37.2733, "center_lng": 127.0142},
    {"id": "ilsan", "name": "고양 일산시장", "city": "경기도 고양시 일산동구", "center_lat": 37.6835, "center_lng": 126.7719},
    {"id": "yukgeori", "name": "청주 육거리종합시장", "city": "충청북도 청주시 상당구", "center_lat": 36.6398, "center_lng": 127.4956},
    {"id": "jecheon-jungang", "name": "제천 중앙시장", "city": "충청북도 제천시", "center_lat": 37.1326, "center_lng": 128.2101},
    {"id": "chungju-muhak", "name": "충주 무학시장", "city": "충청북도 충주시", "center_lat": 36.9910, "center_lng": 127.9259},
    {"id": "gongju-sanseong", "name": "공주 산성시장", "city": "충청남도 공주시", "center_lat": 36.4587, "center_lng": 127.1258},
    {"id": "seocheon", "name": "서천 특화시장", "city": "충청남도 서천군", "center_lat": 36.0801, "center_lng": 126.6912},
    {"id": "byeongcheon", "name": "천안 병천시장", "city": "충청남도 천안시 병천면", "center_lat": 36.7454, "center_lng": 127.2489},
    {"id": "andong-gu", "name": "안동 구시장", "city": "경상북도 안동시", "center_lat": 36.5657, "center_lng": 128.7294},
    {"id": "jukdo", "name": "포항 죽도시장", "city": "경상북도 포항시 북구", "center_lat": 36.0403, "center_lng": 129.3652},
    {"id": "gyeongju-jungang", "name": "경주 중앙시장", "city": "경상북도 경주시", "center_lat": 35.8419, "center_lng": 129.2094},
    {"id": "masan-eosi", "name": "창원 마산어시장", "city": "경상남도 창원시 마산합포구", "center_lat": 35.2059, "center_lng": 128.5709},
    {"id": "jinju-jungang", "name": "진주 중앙시장", "city": "경상남도 진주시", "center_lat": 35.1900, "center_lng": 128.0850},
    {"id": "tongyeong-jungang", "name": "통영 중앙시장", "city": "경상남도 통영시", "center_lat": 34.8459, "center_lng": 128.4341},
    {"id": "jeongseon-arirang", "name": "정선 아리랑시장", "city": "강원특별자치도 정선군", "center_lat": 37.3805, "center_lng": 128.6608},
    {"id": "sokcho", "name": "속초 관광수산시장", "city": "강원특별자치도 속초시", "center_lat": 38.2049, "center_lng": 128.5912},
    {"id": "chuncheon-jungang", "name": "춘천 중앙시장", "city": "강원특별자치도 춘천시", "center_lat": 37.8747, "center_lng": 127.7345},
    {"id": "jeonju-nambu", "name": "전주 남부시장", "city": "전북특별자치도 전주시 완산구", "center_lat": 35.8107, "center_lng": 127.1480},
    {"id": "namwon", "name": "남원 공설시장", "city": "전북특별자치도 남원시", "center_lat": 35.4164, "center_lng": 127.3903},
    {"id": "gunsan", "name": "군산 공설시장", "city": "전북특별자치도 군산시", "center_lat": 35.9676, "center_lng": 126.7368},
    {"id": "jeju-dongmun", "name": "제주 동문시장", "city": "제주특별자치도 제주시", "center_lat": 33.5138, "center_lng": 126.5292},
    {"id": "seogwipo-olle", "name": "서귀포 매일올레시장", "city": "제주특별자치도 서귀포시", "center_lat": 33.2496, "center_lng": 126.5622},
    {"id": "seongsan", "name": "성산 일출시장", "city": "제주특별자치도 서귀포시 성산읍", "center_lat": 33.4587, "center_lng": 126.9273},
]
MARKETS = MARKETS + EXTRA_MARKETS

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
    # 시장 목록은 DB가 비어있을 때만 채우는 게 아니라, 매번 새로 추가된 시장이 있는지
    # id 기준으로 확인해서 없는 것만 채운다 — 이미 운영 중인 DB에 나중에 시장을 더
    # 추가해도(EXTRA_MARKETS) 재배포 한 번으로 반영되게 하기 위함.
    existing_market_ids = {row[0] for row in db.query(Market.id).all()}
    added_market = False
    for m in MARKETS:
        if m["id"] not in existing_market_ids:
            db.add(Market(**m))
            added_market = True
    if added_market:
        db.commit()

    if db.query(Store).count() == 0:
        for s in YANGDONG_STORES:
            db.add(Store(**s))
        db.commit()

    if db.query(Product).count() == 0:
        for p in SEED_PRODUCTS:
            db.add(Product(**p))
        db.commit()
