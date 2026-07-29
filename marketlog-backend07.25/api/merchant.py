from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import shutil, os

from db import get_db
from models import Product, User, product_to_dict
from api.auth import get_current_user

router = APIRouter(tags=["Merchant"])
os.makedirs("uploads", exist_ok=True)


def require_merchant(current_user: User) -> str:
    if current_user.role != "merchant":
        raise HTTPException(status_code=403, detail="판매자 계정만 상품을 등록할 수 있습니다.")
    return current_user.shop_name or current_user.display_name


# 카카오 등록
class KakaoRegisterRequest(BaseModel):
    chatText: str = ""
    imageBase64: str = None

@router.post("/api/kakao-register")
async def kakao_register(
    request: KakaoRegisterRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shop_name = require_merchant(current_user)

    # 나중에 Gemini API 연동할 자리
    product = Product(
        market_id="yangdong",
        region="광주광역시",
        title=request.chatText[:20] if request.chatText else "산지직송 싱싱한 제철 상품",
        shop_name=shop_name,
        distance="300m",
        time_ago="방금 전",
        price=18000,
        public_price=19500,
        price_tag="공공 시세 대비 10% 저렴",
        grade="A+",
        category="수산물",
        image_url="https://lh3.googleusercontent.com/aida-public/AB6AXuBPBsS9pCM36y_2W6Vey0_5EC88SbxJT0t7GhjPXTqlYnaqTLo0NcPV6LFPJH4p8pI2sVispE0SOUUZyXGM7sHnAfTR02l7Ecz_PaENAV0UotAJL_GFQ2-MlPFcyoWoDVhUhvNa5dMeWWVko5qNl4VottlwisP_V2H8J6BvPu4fkLyQ-lAczaPkDamw8VL1R4HpBabcEkOJK7MtMocMNcOhlDpmlg45ZYg8F7B_zr9m5nvPktBbJxjvUA",
        freshness_score=98,
        defect_score=95,
        uniformity_score=92,
        description="새벽 산지 직송으로 신선도가 매우 우수합니다.",
        is_merchant_uploaded=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)

    return {"success": True, "product": product_to_dict(product)}

# 사진 업로드
@router.post("/api/v1/merchant/upload")
async def upload_product(
    price: int = Form(18000),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shop_name = require_merchant(current_user)

    file_path = f"uploads/{file.filename}"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    product = Product(
        market_id="yangdong",
        region="광주광역시",
        title="AI 분석 상품",
        shop_name=shop_name,
        distance="300m",
        time_ago="방금 전",
        price=price,
        public_price=int(price * 1.1),
        price_tag="공공 시세 대비 10% 저렴",
        grade="A+",
        category="수산물",
        image_url=f"/uploads/{file.filename}",
        freshness_score=98,
        defect_score=95,
        uniformity_score=92,
        description="새벽 산지 직송 상품입니다.",
        is_merchant_uploaded=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)

    return {"success": True, "product": product_to_dict(product)}
