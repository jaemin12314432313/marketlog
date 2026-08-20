import json
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Integer, Boolean, Float, DateTime, ForeignKey, UniqueConstraint, Text
from sqlalchemy.orm import relationship

from db import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_uuid)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="customer")  # customer | merchant
    display_name = Column(String, nullable=False)
    phone = Column(String, nullable=False, default="")
    shop_name = Column(String, nullable=True)
    # 상인이 가입 시 고른 소속 전통시장(Market.id) — 상품/점포 등록이 전부 이 시장
    # 기준으로 이뤄진다. null이면(기존 계정) "yangdong"으로 취급한다.
    market_id = Column(String, nullable=True)
    # 마이 탭에서 고르는 프로필 아바타 — 아이콘/색상(주로 상인)과 실제 사진(주로 소비자)
    # 둘 다 저장 API가 없어서 화면을 나갔다 오면(탭 전환 시 MyWallet이 언마운트됨) 매번
    # 초기화되던 걸 고치기 위해 추가했다. profile_image는 data URL(base64)이라 Text로 둔다.
    avatar_icon = Column(String, nullable=True)
    avatar_color = Column(String, nullable=True)
    profile_image = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    bookmarks = relationship("Bookmark", back_populates="user", cascade="all, delete-orphan")
    scanned_products = relationship("ScannedProduct", back_populates="user", cascade="all, delete-orphan")


class Bookmark(Base):
    __tablename__ = "bookmarks"
    __table_args__ = (UniqueConstraint("user_id", "product_id", name="uq_user_product_bookmark"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    product_id = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="bookmarks")


class ScannedProduct(Base):
    __tablename__ = "scanned_products"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    title = Column(String, nullable=False)
    shop_name = Column(String, nullable=False)
    distance = Column(String, nullable=False, default="")
    time_ago = Column(String, nullable=False, default="")
    price = Column(Integer, nullable=False, default=0)
    public_price = Column(Integer, nullable=False, default=0)
    price_tag = Column(String, nullable=False, default="")
    grade = Column(String, nullable=False, default="A")
    category = Column(String, nullable=False, default="AI 추천상품")
    image_url = Column(String, nullable=False, default="")
    freshness_score = Column(Integer, nullable=False, default=0)
    defect_score = Column(Integer, nullable=False, default=0)
    uniformity_score = Column(Integer, nullable=False, default=0)
    description = Column(String, nullable=False, default="")
    ai_summary = Column(String, nullable=True)
    # 촬영 당시 GPS 좌표 — "찍은 위치로 이동하기"에서 지도를 그 지점으로 이동시키는 용도.
    # Product의 scan_lat/scan_lng와 같은 목적이지만 이 표는 상인 상품이 아니라 소비자
    # 개인 스캔 기록이라 별도 테이블에 둔다.
    scan_lat = Column(Float, nullable=True)
    scan_lng = Column(Float, nullable=True)
    # attribute_quality_v3(2026-08-18~)가 실측한 품목별 속성(착색도/신선도/손상 등)의
    # {속성명: {grade, confidence}} JSON — 감자 등 미지원 품목/구형 스캔은 비어 있다.
    attribute_labels = Column(Text, nullable=True)
    # 소비자가 스캔해서 저장해둔 상품에 직접 남기는 개인 메모(예: "가격 괜찮았음",
    # "여기서 또 사지 말기") — 상인이 아니라 이 스캔을 저장한 소비자 본인만 보고 쓴다.
    memo = Column(Text, nullable=True)

    user = relationship("User", back_populates="scanned_products")


class Market(Base):
    __tablename__ = "markets"

    id = Column(String, primary_key=True)  # slug: yangdong | mangwon | jagalchi
    name = Column(String, nullable=False)  # e.g. "광주 양동시장" (프론트가 그대로 조회에 사용)
    city = Column(String, nullable=False, default="")
    congestion = Column(String, nullable=False, default="보통")
    parking_capacity = Column(String, nullable=False, default="")
    toilet_location = Column(String, nullable=False, default="")
    docent_story_title = Column(String, nullable=False, default="")
    docent_script = Column(String, nullable=False, default="")
    audio_duration = Column(String, nullable=False, default="")
    center_lat = Column(Float, nullable=False, default=0.0)
    center_lng = Column(Float, nullable=False, default=0.0)

    stores = relationship("Store", back_populates="market", cascade="all, delete-orphan")


class Store(Base):
    __tablename__ = "stores"

    id = Column(String, primary_key=True, default=gen_uuid)
    market_id = Column(String, ForeignKey("markets.id"), nullable=False)
    name = Column(String, nullable=False)
    subtitle = Column(String, nullable=False, default="")
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    category = Column(String, nullable=False, default="store")
    icon = Column(String, nullable=False, default="storefront")
    badge_color = Column(String, nullable=False, default="#3B82F6")
    grade = Column(String, nullable=False, default="A")
    notice = Column(String, nullable=False, default="")
    notice_time = Column(String, nullable=False, default="")
    alley = Column(String, nullable=False, default="")
    story_text = Column(String, nullable=False, default="")
    phone = Column(String, nullable=False, default="")
    hours = Column(String, nullable=False, default="")
    # 상인이 위치 등록 시 지도를 클릭/검색한 좌표를 역지오코딩해서 자동으로 채워지는
    # 도로명 주소 — 점포 상세 정보에서 위경도 숫자 대신 사람이 읽을 수 있는 위치로 보여준다.
    address = Column(String, nullable=False, default="")

    market = relationship("Market", back_populates="stores")


# 소속 전통시장 선택 기능이 생기기 전에 가입해 이미 점포가 있는 계정은 market_id가 비어
# 있어도 그 점포가 "yangdong"(광주 양동시장) 기준으로 저장돼 있다 — 여러 API 모듈
# (auth.py의 login/me, merchant.py의 점포/상품 조회)이 공통으로 이 사실을 확정해서
# market_id에 기록해야 해서(모듈 간 순환 import를 피하려고) models.py에 둔다.
# market_id가 있으면 그대로, 없고 점포가 실제로 있으면 "yangdong"으로 확정해 기록,
# 점포도 없는 진짜 신규 계정이면 확정하지 않고(마이 탭 시장 선택 온보딩 카드가 계속
# 보이도록) None을 반환한다.
def resolve_merchant_market_id(db, user: "User") -> "str | None":
    if user.market_id:
        return user.market_id
    shop_name = user.shop_name or user.display_name
    existing_store = db.query(Store).filter(Store.market_id == "yangdong", Store.name == shop_name).first()
    if existing_store:
        user.market_id = "yangdong"
        db.commit()
        return "yangdong"
    return None


class Product(Base):
    __tablename__ = "products"

    id = Column(String, primary_key=True, default=gen_uuid)
    market_id = Column(String, ForeignKey("markets.id"), nullable=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=True)
    region = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    title = Column(String, nullable=False)
    unit = Column(String, nullable=False, default="")  # 예: "1kg", "3개" — 상품명과 분리해서 저장
    origin = Column(String, nullable=False, default="")  # 예: "국내산 · 완도" — "완도산 전복"처럼 상품명에 섞어 쓰지 않는다
    tags = Column(String, nullable=False, default="")  # 쉼표로 이어붙인 해시태그, 예: "#달콤한,#산지직송"
    shop_name = Column(String, nullable=False)
    distance = Column(String, nullable=False, default="")
    time_ago = Column(String, nullable=False, default="")
    price = Column(Integer, nullable=False, default=0)
    public_price = Column(Integer, nullable=False, default=0)
    price_tag = Column(String, nullable=False, default="")
    grade = Column(String, nullable=False, default="A")
    category = Column(String, nullable=False, default="AI 추천상품")
    image_url = Column(String, nullable=False, default="")
    freshness_score = Column(Integer, nullable=False, default=0)
    defect_score = Column(Integer, nullable=False, default=0)
    uniformity_score = Column(Integer, nullable=False, default=0)
    # attribute_quality_v3(2026-08-18~)가 실측한 품목별 속성(착색도/신선도/손상 등)의
    # {속성명: {grade, confidence}} JSON — 감자 등 미지원 품목/구형 스캔/수동 등록은 비어 있다.
    attribute_labels = Column(Text, nullable=True)
    description = Column(String, nullable=False, default="")
    is_merchant_uploaded = Column(Boolean, nullable=False, default=False)
    # 카메라 AI 스캔이 실제로(Gemini 등을 통해) 생성한 종합의견 — 상인이 직접 입력하거나
    # "AI 추천 설명" 3개 중 고른 홍보문구(description)와는 별개다. 스캔을 거치지 않은
    # 상품은 이 값이 비어 있고, 그 경우 상세페이지의 "AI 스캔 종합 의견" 섹션 자체를 숨긴다.
    ai_summary = Column(String, nullable=True)
    is_scanned_product = Column(Boolean, nullable=False, default=False)


def product_to_dict(product: Product) -> dict:
    return {
        "id": product.id,
        "title": product.title,
        "unit": product.unit,
        "origin": product.origin,
        "tags": product.tags,
        "shopName": product.shop_name,
        "distance": product.distance,
        "timeAgo": product.time_ago,
        "price": product.price,
        "publicPrice": product.public_price,
        "priceTag": product.price_tag,
        "grade": product.grade,
        "category": product.category,
        "imageUrl": product.image_url,
        "freshnessScore": product.freshness_score,
        "defectScore": product.defect_score,
        "uniformityScore": product.uniformity_score,
        "attributeLabels": json.loads(product.attribute_labels) if product.attribute_labels else None,
        "description": product.description,
        "aiSummary": product.ai_summary,
        "isScannedProduct": product.is_scanned_product,
        "isMerchantUploaded": product.is_merchant_uploaded,
        "region": product.region,
        "marketId": product.market_id,
        "storeId": product.store_id,
        # created_at은 naive UTC(datetime.utcnow())로 저장돼 있어서 'Z'를 안 붙이면
        # 프론트 JS의 Date 파서가 이 문자열을 "브라우저 로컬시간"으로 잘못 해석해
        # KST 기준으로 최대 9시간(자정 근처면 하루 통째로) 어긋난 날짜가 표시된다.
        "createdAt": product.created_at.isoformat() + "Z" if product.created_at else None,
    }
