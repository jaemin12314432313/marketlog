from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
import torch
import base64
import io
import os
from PIL import Image

router = APIRouter(tags=["Consumer"])

# ★ 모델 전역 로드 (서버 시작 시 1회)
device = torch.device("cpu")
item_model = item_classes = item_img_size = None
grading_model = grade_order = grading_img_size = None

def load_models():
    global item_model, item_classes, item_img_size
    global grading_model, grade_order, grading_img_size
    try:
        from marketlog_vision.infer_pipeline import load_item_model, load_grading_model
        item_model, item_classes, item_img_size = load_item_model(
            "checkpoints/item_recognition_effv2s_v2.pt", device
        )
        grading_model, grade_order, grading_img_size = load_grading_model(
            "checkpoints/quality_grading_effv2s_v2.pt", device
        )
        print("✅ AI 모델 로드 완료!")
    except Exception as e:
        print(f"⚠️ 모델 로드 실패 (Mock 모드): {e}")

load_models()

# 등급 매핑
GRADE_MAP = {"특": "A+", "상": "A", "보통": "B"}

# 품목별 공공 시세
PUBLIC_PRICE_MAP = {
    "은갈치": 19500, "갈치": 19500,
    "삼겹살": 19800, "돼지고기": 18000,
    "딸기": 13000, "토마토": 8000,
    "무": 3500, "배추": 5000,
    "감": 12000, "감귤": 8000, "감자": 4000,
}

# 품목별 연관 추천
CROSS_SELL_MAP = {
    "갈치": {"itemName": "가을무", "shopName": "호남상회", "distance": "50m", "discountOffer": "20% OFF", "recipeName": "갈치조림 완성 패키지"},
    "삼겹살": {"itemName": "쌈채소 세트", "shopName": "호남상회", "distance": "40m", "discountOffer": "15% OFF", "recipeName": "삼겹살 파채 구이 패키지"},
    "딸기": {"itemName": "수제 생크림", "shopName": "싱싱청과", "distance": "30m", "discountOffer": "10% OFF", "recipeName": "딸기 파르페 패키지"},
}

DEFAULT_CROSS_SELL = {"itemName": "제철 채소 모둠", "shopName": "호남상회", "distance": "50m", "discountOffer": "10% OFF", "recipeName": "제철 요리 패키지"}

# Mock 데이터
SCAN_MOCK = {
    "hairtail": {
        "productName": "제주산 은갈치 (특대)", "category": "수산물", "grade": "A+",
        "qualityScore": 98, "sellingPrice": 18000, "publicMarketPrice": 19500,
        "priceDiffPercent": 10, "priceTrafficLight": "SAFE",
        "freshnessScore": 98, "defectScore": 95, "uniformityScore": 92,
        "publicGuarantee": "농림축산식품부 공공데이터 연동 보증",
        "aiAnalysisSummary": "은백색 광택이 98% 유지되고 표면 상처가 거의 없는 최상급 은갈치입니다.",
        "crossSellRecommendation": {"itemName": "호남상회 가을무", "shopName": "호남상회", "distance": "50m", "discountOffer": "20% OFF", "recipeName": "갈치조림 완성 패키지"}
    },
    "strawberry": {
        "productName": "논산 설향 딸기 (500g)", "category": "과일/야채", "grade": "A",
        "qualityScore": 93, "sellingPrice": 12500, "publicMarketPrice": 13000,
        "priceDiffPercent": 4, "priceTrafficLight": "SAFE",
        "freshnessScore": 94, "defectScore": 92, "uniformityScore": 91,
        "publicGuarantee": "농림축산식품부 공공데이터 연동 보증",
        "aiAnalysisSummary": "당도가 높아 과즙이 풍부하며 무름 현상이 없는 우수한 상품입니다.",
        "crossSellRecommendation": {"itemName": "싱싱청과 수제 생크림", "shopName": "싱싱청과", "distance": "30m", "discountOffer": "10% OFF", "recipeName": "딸기 파르페 패키지"}
    },
    "pork": {
        "productName": "한돈 삼겹살 (600g 냉장)", "category": "정육", "grade": "A+",
        "qualityScore": 97, "sellingPrice": 16800, "publicMarketPrice": 19800,
        "priceDiffPercent": 15, "priceTrafficLight": "SAFE",
        "freshnessScore": 98, "defectScore": 96, "uniformityScore": 95,
        "publicGuarantee": "농수산물유통공사(KAMIS) 시세 검증 완료",
        "aiAnalysisSummary": "선홍빛 마블링이 우수하며 지방 비율이 매우 균일한 1등급 한돈입니다.",
        "crossSellRecommendation": {"itemName": "호남상회 파채 및 상추 모둠", "shopName": "호남상회", "distance": "40m", "discountOffer": "15% OFF", "recipeName": "삼겹살 파채 구이 패키지"}
    }
}

# ★ 실시간 메모리 DB
feed_db: List[dict] = [
    {
        "id": "prod-1", "title": "제주 은갈치 대자 2마리", "shopName": "양동수산",
        "distance": "800m", "timeAgo": "방금 전", "price": 18000, "publicPrice": 19500,
        "priceTag": "공공 시세 대비 10% 저렴", "grade": "A+", "category": "수산물",
        "imageUrl": "https://lh3.googleusercontent.com/aida-public/AB6AXuBPBsS9pCM36y_2W6Vey0_5EC88SbxJT0t7GhjPXTqlYnaqTLo0NcPV6LFPJH4p8pI2sVispE0SOUUZyXGM7sHnAfTR02l7Ecz_PaENAV0UotAJL_GFQ2-MlPFcyoWoDVhUhvNa5dMeWWVko5qNl4VottlwisP_V2H8J6BvPu4fkLyQ-lAczaPkDamw8VL1R4HpBabcEkOJK7MtMocMNcOhlDpmlg45ZYg8F7B_zr9m5nvPktBbJxjvUA",
        "freshnessScore": 98, "defectScore": 95, "uniformityScore": 92,
        "description": "새벽 목포 수협 위판장에서 경매로 낙찰받아 즉송된 완도산 은갈치입니다.",
        "isMerchantUploaded": False
    },
    {
        "id": "prod-2", "title": "논산 설향 딸기 500g", "shopName": "싱싱청과",
        "distance": "1.2km", "timeAgo": "10분 전", "price": 12500, "publicPrice": 13000,
        "priceTag": "시세와 비슷한 수준", "grade": "B+", "category": "과일",
        "imageUrl": "https://lh3.googleusercontent.com/aida-public/AB6AXuDPrTKft45sE79PKyzcNxkpR7jiC94SaLZBeIpOho8PS6MfxcM24FBq5mPUD-KQhGgWNaVSPodpYSrMEPgddi0FNoTIy5QByRJ1O29bN2GoPyZ_bHdyNd5oLvlWDvbU1IxCuntiDyiletIj2q2SHcDwhgzncBso0wtlMj6iVE_kmfeXMGwbx6c0QNetTRXhf0m91HziI7YK5e-OWXOgc84THY9rQc3IN9xQ2glKexbCJmw0SCF4BrhWOw",
        "freshnessScore": 94, "defectScore": 92, "uniformityScore": 91,
        "description": "당도가 높아 과즙이 풍부하며 무름 현상이 없는 우수한 상품입니다.",
        "isMerchantUploaded": False
    },
    {
        "id": "prod-3", "title": "한돈 삼겹살 600g (냉장)", "shopName": "우리축산",
        "distance": "300m", "timeAgo": "방금 전", "price": 16800, "publicPrice": 19800,
        "priceTag": "공공 시세 대비 15% 저렴", "grade": "A+", "category": "정육",
        "imageUrl": "https://lh3.googleusercontent.com/aida-public/AB6AXuDfqKKJROFYLfdHz4E-dhGPYRcjGFgyiVvPNDRmUVShw2Z2MABEaTDMc3Yh-oO77txFIhM4Fko4dPgwWTc4rYljeZnxkIfQcnrLP9JEOVhqXwiVmd5UxKDOBLXFugDB2zSgwLp4FR-guYiZtxriswvRdiFTkbxW2WcC9swB-xuvAG4kr3R3OIomDMdUDdfW0t8d2__fEnZGUFSVN-2Y6i8MIpXxpixAPZcIYGT2pHfzOSqTFdiVjw5Bfg",
        "freshnessScore": 98, "defectScore": 96, "uniformityScore": 95,
        "description": "선홍빛 마블링이 우수하며 지방 비율이 매우 균일한 1등급 한돈입니다.",
        "isMerchantUploaded": False
    }
]

def run_ai_inference(image: Image.Image) -> dict:
    if item_model is None:
        return None
    try:
        from marketlog_vision.infer_pipeline import run_pipeline
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            image.save(tmp.name)
            tmp_path = tmp.name
        result = run_pipeline(
            tmp_path,
            item_model, item_classes, item_img_size,
            grading_model, grade_order, grading_img_size,
            device
        )
        os.unlink(tmp_path)
        return result
    except Exception as e:
        print(f"추론 오류: {e}")
        return None

# 피드 조회
@router.get("/api/v1/consumer/feed")
async def get_feeds():
    return feed_db

# AI 스캔 (base64 이미지)
class ScanRequest(BaseModel):
    sampleId: str = "hairtail"
    imageBase64: Optional[str] = None

@router.post("/api/analyze-product")
async def analyze_product(request: ScanRequest):
    # base64 이미지 있으면 실제 모델 추론
    if request.imageBase64 and item_model is not None:
        try:
            img_data = base64.b64decode(request.imageBase64.split(",")[-1])
            image = Image.open(io.BytesIO(img_data)).convert("RGB")
            result = run_ai_inference(image)

            if result:
                item_name = result["item"]
                grade_kor = result["grade"]
                grade = GRADE_MAP.get(grade_kor, "A")
                confidence = result["item_confidence"]
                thresholds = result["grade_thresholds"]

                public_price = next(
                    (v for k, v in PUBLIC_PRICE_MAP.items() if k in item_name), 10000
                )
                cross_sell = next(
                    (v for k, v in CROSS_SELL_MAP.items() if k in item_name), DEFAULT_CROSS_SELL
                )

                freshness = int(thresholds[-1] * 100) if thresholds else 90
                defect = int((1 - thresholds[0]) * 100) if thresholds else 85
                uniformity = int(confidence * 100)

                return {
                    "success": True,
                    "data": {
                        "productName": item_name,
                        "category": "농수산물",
                        "grade": grade,
                        "qualityScore": uniformity,
                        "sellingPrice": 0,
                        "publicMarketPrice": public_price,
                        "priceDiffPercent": 0,
                        "priceTrafficLight": "SAFE",
                        "freshnessScore": freshness,
                        "defectScore": defect,
                        "uniformityScore": uniformity,
                        "publicGuarantee": "농림축산식품부 공공데이터 연동 보증",
                        "aiAnalysisSummary": f"AI 분석 결과 {item_name} {grade_kor}등급으로 판정되었습니다. (신뢰도: {confidence*100:.1f}%)",
                        "crossSellRecommendation": cross_sell
                    }
                }
        except Exception as e:
            print(f"base64 처리 오류: {e}")

    # Mock 데이터 반환 (모델 없거나 이미지 없을 때)
    data = SCAN_MOCK.get(request.sampleId, SCAN_MOCK["hairtail"])
    return {"success": True, "data": data}

# 도슨트
class DocentRequest(BaseModel):
    marketName: str
    alleyName: str = "수산물 골목"

@router.post("/api/docent-story")
async def docent_story(request: DocentRequest):
    return {
        "success": True,
        "script": f'"{request.marketName}의 {request.alleyName}에 오신 것을 환영합니다. 매일 새벽 산지에서 직송된 신선한 제철 상품을 만나보세요."'
    }

# 가게 스토리
@router.get("/api/v1/consumer/store/{store_id}/story")
async def get_store_story(store_id: str):
    stories = {
        "fish_12": "양동수산은 30년 전통의 수산물 전문점으로, 매일 새벽 목포 위판장에서 직송된 신선한 활어를 취급합니다.",
        "meat_05": "우리축산은 지리산 청정 농가에서 직접 가져온 최고급 한돈을 전문으로 합니다.",
        "veg_01": "싱싱야채는 전남 나주 산지 직송 채소를 당일 공수하여 신선도를 보장합니다."
    }
    return {
        "store_name": store_id,
        "story_text": stories.get(store_id, "전통시장의 오랜 역사와 함께한 신뢰할 수 있는 가게입니다.")
    }