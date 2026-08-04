from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import torch
import base64
import io
import os
import json
from PIL import Image

from db import get_db
from models import Market, Product, Store, product_to_dict
from kamis import get_public_price as get_kamis_price

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
        print("AI 모델 로드 완료")
    except Exception as e:
        print(f"모델 로드 실패 (Mock 모드): {e}")

load_models()

# 등급 매핑
GRADE_MAP = {"특": "A+", "상": "A", "보통": "B"}

# 품목별 공공 시세
# 품목 인식 모델의 실제 10개 클래스(무·배추·양파·마늘·양배추·감·사과·배·감귤·감자) 기준.
# "배"/"감"이 "배추"/"양배추", "감귤"/"감자"의 부분 문자열이라 substring 매칭 순서상
# 더 구체적인 품목명을 먼저 둬야 한다 (아래 순서를 바꾸지 말 것).
PUBLIC_PRICE_MAP = {
    "양배추": 4500, "배추": 5000, "배": 20000,
    "감귤": 8000, "감자": 4000, "감": 12000,
    "무": 3500, "양파": 3000, "마늘": 12000, "사과": 15000,
    "은갈치": 19500, "갈치": 19500,
    "삼겹살": 19800, "돼지고기": 18000,
    "딸기": 13000, "토마토": 8000,
}

# 품목별 연관 추천 (동일한 순서 제약 적용)
CROSS_SELL_MAP = {
    "양배추": {"itemName": "돈까스 소스", "shopName": "호남상회", "distance": "30m", "discountOffer": "10% OFF", "recipeName": "양배추쌈 정식 패키지"},
    "배추": {"itemName": "대파 & 고춧가루", "shopName": "호남상회", "distance": "20m", "discountOffer": "15% OFF", "recipeName": "김치 담그기 패키지"},
    "배": {"itemName": "배즙용 생강", "shopName": "싱싱청과", "distance": "30m", "discountOffer": "10% OFF", "recipeName": "배숙 디저트 패키지"},
    "감귤": {"itemName": "한라봉", "shopName": "싱싱청과", "distance": "30m", "discountOffer": "10% OFF", "recipeName": "감귤청 만들기 패키지"},
    "감자": {"itemName": "양파", "shopName": "호남상회", "distance": "20m", "discountOffer": "10% OFF", "recipeName": "감자조림 패키지"},
    "감": {"itemName": "곶감 채반", "shopName": "싱싱청과", "distance": "30m", "discountOffer": "10% OFF", "recipeName": "홍시 디저트 패키지"},
    "무": {"itemName": "가을무 조림양념", "shopName": "호남상회", "distance": "50m", "discountOffer": "20% OFF", "recipeName": "무생채 반찬 패키지"},
    "양파": {"itemName": "당근", "shopName": "호남상회", "distance": "20m", "discountOffer": "10% OFF", "recipeName": "볶음요리 야채세트 패키지"},
    "마늘": {"itemName": "생강", "shopName": "호남상회", "distance": "20m", "discountOffer": "10% OFF", "recipeName": "양념장 재료 세트"},
    "사과": {"itemName": "수제 그래놀라", "shopName": "싱싱청과", "distance": "30m", "discountOffer": "10% OFF", "recipeName": "사과 샐러드 패키지"},
    "갈치": {"itemName": "가을무", "shopName": "호남상회", "distance": "50m", "discountOffer": "20% OFF", "recipeName": "갈치조림 완성 패키지"},
    "삼겹살": {"itemName": "쌈채소 세트", "shopName": "호남상회", "distance": "40m", "discountOffer": "15% OFF", "recipeName": "삼겹살 파채 구이 패키지"},
    "딸기": {"itemName": "수제 생크림", "shopName": "싱싱청과", "distance": "30m", "discountOffer": "10% OFF", "recipeName": "딸기 파르페 패키지"},
}

DEFAULT_CROSS_SELL = {"itemName": "제철 채소 모둠", "shopName": "호남상회", "distance": "50m", "discountOffer": "10% OFF", "recipeName": "제철 요리 패키지"}

# SCAN_MOCK의 sampleId -> KAMIS 조회용 순수 품목명.
# get_kamis_price는 이제 항상 원/kg을 반환하므로, 데모 상품명의 실제 중량(pack_weight_kg)을
# 곱해야 "5개입"/"2kg" 같은 묶음 단위와 비교 가능한 금액이 나온다.
SAMPLE_TO_KAMIS_ITEM = {
    "radish": {"item": "무", "pack_weight_kg": 1.5},   # "1단" ≈ 무 1개(kamis.ITEM_CONFIG 기준 1.5kg)
    "apple": {"item": "사과", "pack_weight_kg": 1.5},   # "5개입" ≈ 5 × 300g
    "potato": {"item": "감자", "pack_weight_kg": 2},    # "2kg" 그대로
}

# Mock 데이터 (카메라/모델을 쓸 수 없을 때의 폴백 — 품목 인식 모델의 실제 10개 클래스 기준)
SCAN_MOCK = {
    "radish": {
        "productName": "국내산 가을무 (1단)", "category": "신선야채", "grade": "특",
        "qualityScore": 96, "sellingPrice": 3200, "publicMarketPrice": 3500,
        "priceDiffPercent": 9, "priceTrafficLight": "SAFE",
        "freshnessScore": 96, "defectScore": 94, "uniformityScore": 93,
        "aiAnalysisSummary": "표면이 매끈하고 무름 없이 단단하여 신선도가 우수한 무입니다.",
        "crossSellRecommendation": {"itemName": "가을무 조림양념", "shopName": "호남상회", "distance": "50m", "discountOffer": "20% OFF", "recipeName": "무생채 반찬 패키지"}
    },
    "apple": {
        "productName": "청송 부사 사과 (5개입)", "category": "과일", "grade": "상",
        "qualityScore": 93, "sellingPrice": 13500, "publicMarketPrice": 15000,
        "priceDiffPercent": 10, "priceTrafficLight": "SAFE",
        "freshnessScore": 94, "defectScore": 92, "uniformityScore": 91,
        "aiAnalysisSummary": "당도가 높고 표면 흠집이 거의 없는 우수한 사과입니다.",
        "crossSellRecommendation": {"itemName": "수제 그래놀라", "shopName": "싱싱청과", "distance": "30m", "discountOffer": "10% OFF", "recipeName": "사과 샐러드 패키지"}
    },
    "potato": {
        "productName": "국내산 수미 감자 (2kg)", "category": "신선야채", "grade": "보통",
        "qualityScore": 90, "sellingPrice": 3600, "publicMarketPrice": 4000,
        "priceDiffPercent": 10, "priceTrafficLight": "SAFE",
        "freshnessScore": 91, "defectScore": 88, "uniformityScore": 90,
        "aiAnalysisSummary": "크기가 고르고 싹이 나지 않은 양호한 상태의 감자입니다.",
        "crossSellRecommendation": {"itemName": "양파", "shopName": "호남상회", "distance": "20m", "discountOffer": "10% OFF", "recipeName": "감자조림 패키지"}
    }
}

_gemini_client = None
_gemini_client_checked = False

def get_gemini_client():
    """Gemini 클라이언트를 지연 초기화한다. 키가 없거나 SDK 미설치 시 None."""
    global _gemini_client, _gemini_client_checked
    if _gemini_client_checked:
        return _gemini_client
    _gemini_client_checked = True
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        from google import genai
        _gemini_client = genai.Client(api_key=api_key)
    except Exception as e:
        print(f"Gemini 클라이언트 초기화 실패: {e}")
        _gemini_client = None
    return _gemini_client


def generate_ai_commentary(image: Image.Image, item_name: str, grade_kor: str) -> Optional[dict]:
    """이미 확정된 품목/등급(우리 학습 모델의 결과)을 그대로 두고, 사진을 근거로
    신선도/표면결함/균일도 세부 점수와 종합의견만 Gemini에게 생성시킨다.
    Gemini 호출이 실패하면 None을 반환해 호출부에서 기존 방식으로 폴백하게 한다.
    """
    client = get_gemini_client()
    if client is None:
        return None
    try:
        from google.genai import types

        buf = io.BytesIO()
        image.save(buf, format="JPEG")

        prompt = (
            f"이 사진 속 품목은 '{item_name}'이고, 별도의 전용 분류 모델이 이미 품질 등급을 "
            f"'{grade_kor}'(특/상/보통 중 하나)로 판정했습니다. 등급 자체는 이미 확정된 값이니 "
            f"바꾸지 말고, 이 사진을 시각적으로 근거로 삼아 신선도(freshnessScore)/표면 결함 없음"
            f"(defectScore)/크기·색상 균일도(uniformityScore)를 각각 0~100 사이 정수로 추정하고, "
            f"'{grade_kor}' 등급인 이유를 설명하는 2문장 내외의 종합의견(aiAnalysisSummary)을 "
            f"한국어로 작성하세요."
        )

        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=[
                types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"),
                prompt,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema={
                    "type": "OBJECT",
                    "properties": {
                        "freshnessScore": {"type": "INTEGER"},
                        "defectScore": {"type": "INTEGER"},
                        "uniformityScore": {"type": "INTEGER"},
                        "aiAnalysisSummary": {"type": "STRING"},
                    },
                    "required": [
                        "freshnessScore", "defectScore", "uniformityScore", "aiAnalysisSummary",
                    ],
                },
            ),
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"Gemini 해설 생성 실패 (기존 방식으로 폴백): {e}")
        return None


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
async def get_feeds(db: Session = Depends(get_db)):
    products = db.query(Product).order_by(Product.created_at.desc()).all()
    return [product_to_dict(p) for p in products]

# AI 스캔 (base64 이미지)
class ScanRequest(BaseModel):
    sampleId: str = "apple"
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

                public_price = get_kamis_price(item_name, grade_kor)
                is_kamis_verified = public_price is not None
                if public_price is None:
                    public_price = next(
                        (v for k, v in PUBLIC_PRICE_MAP.items() if k in item_name), 10000
                    )
                cross_sell = next(
                    (v for k, v in CROSS_SELL_MAP.items() if k in item_name), DEFAULT_CROSS_SELL
                )

                # 세부 점수/종합의견은 Gemini에게 맡기고, 실패 시에만 기존 방식(등급확률/확신도 재활용)으로 폴백
                commentary = generate_ai_commentary(image, item_name, grade_kor)
                if commentary:
                    freshness = commentary["freshnessScore"]
                    defect = commentary["defectScore"]
                    uniformity = commentary["uniformityScore"]
                    summary = commentary["aiAnalysisSummary"]
                else:
                    freshness = int(thresholds[-1] * 100) if thresholds else 90
                    defect = int((1 - thresholds[0]) * 100) if thresholds else 85
                    uniformity = int(confidence * 100)
                    summary = f"AI 분석 결과 {item_name} {grade_kor}등급으로 판정되었습니다. (신뢰도: {confidence*100:.1f}%)"

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
                        "publicGuarantee": (
                            "농산물유통정보(KAMIS) 소매가격 실시간 연동"
                            if is_kamis_verified
                            else "참고 시세 (KAMIS 데이터 없음 — 자체 추정치)"
                        ),
                        "aiAnalysisSummary": summary,
                        "crossSellRecommendation": cross_sell
                    }
                }
        except Exception as e:
            print(f"base64 처리 오류: {e}")

    # Mock 데이터 반환 (모델 없거나 이미지 없을 때) — 공공시세만큼은 가능하면 KAMIS 실데이터로 교체.
    # sellingPrice는 실제 판매자가 매긴 값이 아니라 데모용 임의값이므로, 고정해야 할 것은
    # 절대 금액이 아니라 SCAN_MOCK에 이미 있는 "목표 할인율"(priceDiffPercent)이다.
    # 라이브 공공시세는 매일 바뀌므로 sellingPrice를 그 기준으로 역산해야, 어느 날 시연해도
    # "공공시세 대비 N% 저렴" 스토리가 유지된다 (절대값을 고정하면 부호가 뒤집힐 수 있음).
    data = dict(SCAN_MOCK.get(request.sampleId, SCAN_MOCK["apple"]))
    target_discount_percent = data["priceDiffPercent"]
    kamis_config = SAMPLE_TO_KAMIS_ITEM.get(request.sampleId)
    kamis_unit_price = get_kamis_price(kamis_config["item"], data["grade"]) if kamis_config else None
    if kamis_unit_price is not None:
        kamis_price = round(kamis_unit_price * kamis_config["pack_weight_kg"])
        data["publicMarketPrice"] = kamis_price
        data["sellingPrice"] = round(kamis_price * (1 - target_discount_percent / 100))
        data["publicGuarantee"] = "농산물유통정보(KAMIS) 소매가격 실시간 연동"
    else:
        data["publicGuarantee"] = "참고 시세 (KAMIS 데이터 없음 — 자체 추정치)"
    return {"success": True, "data": data}

# 도슨트
class DocentRequest(BaseModel):
    marketName: str
    alleyName: str = "수산물 골목"
    storeId: Optional[str] = None


# Gemini 무료 티어는 분당 5회 호출로 제한된다. 지도에서 핀을 연달아 클릭하면 금방 한도를
# 넘기므로, 같은 점포는 잠깐 동안 재사용해서 실제 호출 횟수를 줄인다.
_DOCENT_CACHE_TTL = timedelta(minutes=30)
_docent_cache: dict = {}


def _cached_or_generate(cache_key: str, generate) -> str:
    cached = _docent_cache.get(cache_key)
    if cached and datetime.now() - cached[1] < _DOCENT_CACHE_TTL:
        return cached[0]
    script = generate()
    _docent_cache[cache_key] = (script, datetime.now())
    return script


def generate_docent_script_for_store(market_name: str, store: Store) -> str:
    """클릭한 '그 점포 하나'에 대한 도슨트를 생성한다 (구역 전체가 아니라).
    Gemini 실패 시 같은 점포 데이터로 만든 템플릿 문장으로 폴백한다.
    """
    highlight = store.notice or store.category

    client = get_gemini_client()
    if client is not None:
        try:
            from google.genai import types

            prompt = (
                f"당신은 전통시장 오디오 도슨트 해설자입니다. 손님이 방금 '{market_name}'의 "
                f"'{store.alley}' 구역에 있는 점포 '{store.name}' 앞에 멈춰 섰습니다. "
                f"이 점포가 취급하는 품목은 '{highlight}'입니다.\n"
                f"참고 정보: {store.story_text or '추가 정보 없음'}\n\n"
                f"다른 점포는 언급하지 말고 이 점포 하나에 집중해서, 3~4문장의 자연스러운 "
                f"한국어 구어체 해설을 작성하세요. 참고 정보에 있는 사실(위치, 골목 분위기 등)을 "
                f"자연스럽게 녹여서 매번 다른 인상을 주도록 하고, '안녕하세요, 지금 서 계신 곳은' "
                f"같은 뻔한 도입부를 반복하지 마세요. 없는 사실을 지어내지 말고, 따옴표로 감싸지 마세요."
            )
            response = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=[prompt],
                config=types.GenerateContentConfig(temperature=1.1),
            )
            text = (response.text or "").strip()
            if text:
                return f'"{text}"'
        except Exception as e:
            print(f"Gemini 도슨트 생성 실패 (템플릿으로 폴백): {e}")

    return f'"{store.name}에 오신 것을 환영합니다. {highlight}을(를) 만나보세요."'


def generate_docent_script(market_name: str, alley_name: str, stores: list[Store]) -> str:
    """실제 DB 점포 데이터를 근거로 도슨트 해설을 생성한다.
    Gemini 키가 없거나 호출이 실패하면 같은 데이터로 만든 템플릿 문장으로 폴백한다.
    """
    highlights = [f"{s.name}({s.notice})" if s.notice else s.name for s in stores[:4]]

    client = get_gemini_client()
    if client is not None and highlights:
        try:
            prompt = (
                f"당신은 전통시장 오디오 도슨트 해설자입니다. '{market_name}' 안의 '{alley_name}' 구역을 "
                f"둘러보는 손님에게 들려줄 자연스러운 한국어 해설을 2~3문장으로 작성하세요. "
                f"이 구역에는 다음 실제 점포들이 있습니다: {', '.join(highlights)}. "
                f"실제 점포명과 취급 품목을 자연스럽게 언급하며 친근하고 생동감 있는 구어체로 "
                f"작성하고, 없는 사실을 지어내지 마세요. 따옴표로 감싸지 마세요."
            )
            response = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=[prompt],
            )
            text = (response.text or "").strip()
            if text:
                return f'"{text}"'
        except Exception as e:
            print(f"Gemini 도슨트 생성 실패 (템플릿으로 폴백): {e}")

    if highlights:
        joined = ", ".join(highlights[:3])
        return f'"{alley_name}에 오신 것을 환영합니다. {joined} 등 다양한 점포를 만나보세요."'
    return f'"{market_name}의 {alley_name}에 오신 것을 환영합니다."'


@router.post("/api/docent-story")
async def docent_story(request: DocentRequest, db: Session = Depends(get_db)):
    market = db.query(Market).filter(Market.name == request.marketName).first()

    if market and request.storeId:
        store = db.query(Store).filter(Store.id == request.storeId, Store.market_id == market.id).first()
        if store:
            script = _cached_or_generate(
                f"store:{store.id}",
                lambda: generate_docent_script_for_store(request.marketName, store),
            )
            return {"success": True, "script": script}

    # storeId가 없거나 못 찾은 경우 — 기존처럼 구역 단위로 폴백
    stores = (
        db.query(Store)
        .filter(Store.market_id == market.id, Store.alley == request.alleyName)
        .all()
        if market
        else []
    )
    script = _cached_or_generate(
        f"alley:{request.marketName}:{request.alleyName}",
        lambda: generate_docent_script(request.marketName, request.alleyName, stores),
    )
    return {"success": True, "script": script}

# 가게 스토리
@router.get("/api/v1/consumer/store/{store_id}/story")
async def get_store_story(store_id: str, db: Session = Depends(get_db)):
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="가게를 찾을 수 없습니다.")
    return {"store_name": store.name, "story_text": store.story_text}