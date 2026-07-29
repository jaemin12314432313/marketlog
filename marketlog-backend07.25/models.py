import uuid
from datetime import datetime

from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from db import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="customer")  # customer | merchant
    display_name = Column(String, nullable=False)
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
