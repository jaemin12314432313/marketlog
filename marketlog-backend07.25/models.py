import uuid
from datetime import datetime

from sqlalchemy import Column, String, Integer, Boolean, Float, DateTime, ForeignKey, UniqueConstraint
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

    market = relationship("Market", back_populates="stores")


class Product(Base):
    __tablename__ = "products"

    id = Column(String, primary_key=True, default=gen_uuid)
    market_id = Column(String, ForeignKey("markets.id"), nullable=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=True)
    region = Column(String, nullable=True)
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
    is_merchant_uploaded = Column(Boolean, nullable=False, default=False)


def product_to_dict(product: Product) -> dict:
    return {
        "id": product.id,
        "title": product.title,
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
        "description": product.description,
        "isMerchantUploaded": product.is_merchant_uploaded,
        "region": product.region,
        "marketId": product.market_id,
        "storeId": product.store_id,
        "createdAt": product.created_at.isoformat() if product.created_at else None,
    }
