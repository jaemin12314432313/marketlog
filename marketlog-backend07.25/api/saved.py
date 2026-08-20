import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import get_db
from models import Bookmark, ScannedProduct, User, Product, product_to_dict
from api.auth import get_current_user

router = APIRouter(prefix="/api/v1/saved", tags=["Saved"])


def scanned_to_dict(item: ScannedProduct) -> dict:
    return {
        "id": item.id,
        "title": item.title,
        "shopName": item.shop_name,
        "distance": item.distance,
        "timeAgo": item.time_ago,
        "price": item.price,
        "publicPrice": item.public_price,
        "priceTag": item.price_tag,
        "grade": item.grade,
        "category": item.category,
        "imageUrl": item.image_url,
        "freshnessScore": item.freshness_score,
        "defectScore": item.defect_score,
        "uniformityScore": item.uniformity_score,
        "attributeLabels": json.loads(item.attribute_labels) if item.attribute_labels else None,
        "description": item.description,
        "aiSummary": item.ai_summary,
        "scanLat": item.scan_lat,
        "scanLng": item.scan_lng,
        "memo": item.memo,
        "createdAt": item.created_at.isoformat() + "Z" if item.created_at else None,
    }


# ---------- 북마크(찜) ----------

@router.get("/bookmarks")
def list_bookmarks(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bookmarks = db.query(Bookmark).filter(Bookmark.user_id == current_user.id).all()
    product_ids = [b.product_id for b in bookmarks]
    if not product_ids:
        return []
    products = db.query(Product).filter(Product.id.in_(product_ids)).all()
    return [product_to_dict(p) for p in products]


@router.post("/bookmarks/{product_id}")
def add_bookmark(product_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not db.query(Product).filter(Product.id == product_id).first():
        raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다.")

    existing = (
        db.query(Bookmark)
        .filter(Bookmark.user_id == current_user.id, Bookmark.product_id == product_id)
        .first()
    )
    if not existing:
        db.add(Bookmark(user_id=current_user.id, product_id=product_id))
        db.commit()
    return {"success": True}


@router.delete("/bookmarks/{product_id}")
def remove_bookmark(product_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Bookmark).filter(
        Bookmark.user_id == current_user.id, Bookmark.product_id == product_id
    ).delete()
    db.commit()
    return {"success": True}


# ---------- AI 스캔 저장목록 ----------

class ScannedProductIn(BaseModel):
    title: str
    shopName: str
    distance: str = ""
    timeAgo: str = ""
    price: int = 0
    publicPrice: int = 0
    priceTag: str = ""
    grade: str = "A"
    category: str = "AI 추천상품"
    imageUrl: str = ""
    freshnessScore: int = 0
    defectScore: int = 0
    uniformityScore: int = 0
    attributeLabels: Optional[dict] = None
    description: str = ""
    aiSummary: Optional[str] = None
    scanLat: Optional[float] = None
    scanLng: Optional[float] = None


@router.get("/scanned")
def list_scanned(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = (
        db.query(ScannedProduct)
        .filter(ScannedProduct.user_id == current_user.id)
        .order_by(ScannedProduct.created_at.desc())
        .all()
    )
    return [scanned_to_dict(item) for item in items]


@router.post("/scanned")
def add_scanned(
    payload: ScannedProductIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = ScannedProduct(
        user_id=current_user.id,
        title=payload.title,
        shop_name=payload.shopName,
        distance=payload.distance,
        time_ago=payload.timeAgo,
        price=payload.price,
        public_price=payload.publicPrice,
        price_tag=payload.priceTag,
        grade=payload.grade,
        category=payload.category,
        image_url=payload.imageUrl,
        freshness_score=payload.freshnessScore,
        defect_score=payload.defectScore,
        uniformity_score=payload.uniformityScore,
        attribute_labels=json.dumps(payload.attributeLabels, ensure_ascii=False) if payload.attributeLabels else None,
        description=payload.description,
        ai_summary=payload.aiSummary,
        scan_lat=payload.scanLat,
        scan_lng=payload.scanLng,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"success": True, "product": scanned_to_dict(item)}


@router.delete("/scanned/{item_id}")
def remove_scanned(item_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    deleted = (
        db.query(ScannedProduct)
        .filter(ScannedProduct.id == item_id, ScannedProduct.user_id == current_user.id)
        .delete()
    )
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="스캔 저장 항목을 찾을 수 없습니다.")
    return {"success": True}


class MemoIn(BaseModel):
    memo: str = ""


@router.put("/scanned/{item_id}/memo")
def update_scanned_memo(
    item_id: str,
    payload: MemoIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = (
        db.query(ScannedProduct)
        .filter(ScannedProduct.id == item_id, ScannedProduct.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="스캔 저장 항목을 찾을 수 없습니다.")
    item.memo = payload.memo or None
    db.commit()
    db.refresh(item)
    return {"success": True, "product": scanned_to_dict(item)}
