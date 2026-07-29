from fastapi import APIRouter, UploadFile, File, Form
from pydantic import BaseModel
import shutil, os, time
from api.consumer import feed_db

router = APIRouter(tags=["Merchant"])
os.makedirs("uploads", exist_ok=True)

# 카카오 등록
class KakaoRegisterRequest(BaseModel):
    chatText: str = ""
    imageBase64: str = None
    merchantName: str = "양동수산"

@router.post("/api/kakao-register")
async def kakao_register(request: KakaoRegisterRequest):
    # 나중에 Gemini API 연동할 자리
    new_product = {
        "id": f"prod-{int(time.time())}",
        "title": request.chatText[:20] if request.chatText else "산지직송 싱싱한 제철 상품",
        "shopName": request.merchantName,
        "distance": "300m",
        "timeAgo": "방금 전",
        "price": 18000,
        "publicPrice": 19500,
        "priceTag": "공공 시세 대비 10% 저렴",
        "grade": "A+",
        "category": "수산물",
        "imageUrl": "https://lh3.googleusercontent.com/aida-public/AB6AXuBPBsS9pCM36y_2W6Vey0_5EC88SbxJT0t7GhjPXTqlYnaqTLo0NcPV6LFPJH4p8pI2sVispE0SOUUZyXGM7sHnAfTR02l7Ecz_PaENAV0UotAJL_GFQ2-MlPFcyoWoDVhUhvNa5dMeWWVko5qNl4VottlwisP_V2H8J6BvPu4fkLyQ-lAczaPkDamw8VL1R4HpBabcEkOJK7MtMocMNcOhlDpmlg45ZYg8F7B_zr9m5nvPktBbJxjvUA",
        "freshnessScore": 98,
        "defectScore": 95,
        "uniformityScore": 92,
        "description": "새벽 산지 직송으로 신선도가 매우 우수합니다.",
        "isMerchantUploaded": True
    }

    # 피드 맨 앞에 추가
    feed_db.insert(0, new_product)

    return {
        "success": True,
        "product": new_product
    }

# 사진 업로드
@router.post("/api/v1/merchant/upload")
async def upload_product(
    store_name: str = Form("양동수산"),
    price: int = Form(18000),
    file: UploadFile = File(...)
):
    file_path = f"uploads/{file.filename}"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    new_product = {
        "id": f"prod-{int(time.time())}",
        "title": "AI 분석 상품",
        "shopName": store_name,
        "distance": "300m",
        "timeAgo": "방금 전",
        "price": price,
        "publicPrice": int(price * 1.1),
        "priceTag": "공공 시세 대비 10% 저렴",
        "grade": "A+",
        "category": "수산물",
        "imageUrl": f"/uploads/{file.filename}",
        "freshnessScore": 98,
        "defectScore": 95,
        "uniformityScore": 92,
        "description": "새벽 산지 직송 상품입니다.",
        "isMerchantUploaded": True
    }

    feed_db.insert(0, new_product)

    return {
        "success": True,
        "product": new_product
    }