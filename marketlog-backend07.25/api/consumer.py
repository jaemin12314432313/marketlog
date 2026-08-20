from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import asyncio
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

# 체크포인트(약 180MB, YOLO 검출기+품목분류기+등급판정기 3개)를 서버 기동 시점에 바로
# 올리면, 메모리가 빠듯한 배포 환경에서는 첫 요청을 받기도 전에 부팅 중에 OOM으로
# 죽어버려서 로그인/피드/지도 등 AI 스캔과 무관한 기능까지 전부 못 쓰게 된다. 그래서
# 실제로 AI 스캔이 처음 호출될 때 딱 한 번만 지연 로드한다 — 그러면 최소한 메모리가
# 부족해도 AI 스캔 기능만 실패하고 나머지 앱은 계속 살아있다.
#
# 2026-08-13: 비전팀 새 파이프라인(mlv2.pipeline)으로 교체. 검출(YOLO) → 크롭 → 품목분류
# → 등급판정 순으로 동작하고, 예전과 달리 "사진에서 농산물을 아예 못 찾음"(ok:false)이라는
# 정상적인 실패 케이스가 생겼다. 마늘은 이 모델에서 사실상 지원하지 않는다(품목표 자체엔
# 있지만 정확도가 낮아 "무"로 틀리게 확신하는 경우가 많음 — 비전팀 문서 참고).
torch.set_num_threads(1)
vision_pipeline = None
_models_load_attempted = False

def ensure_models_loaded():
    global vision_pipeline, _models_load_attempted
    if _models_load_attempted:
        return
    _models_load_attempted = True
    try:
        from mlv2.pipeline import Pipeline
        vision_pipeline = Pipeline(device="cpu")
        print("AI 모델 로드 완료")
    except Exception as e:
        print(f"모델 로드 실패 (Mock 모드): {e}")

# 등급 매핑 — mlv2 옛 그레이더(감자 등 폴백 경로)는 2단계(특상/보통)로 판정한다.
# attribute_quality_v3(2026-08-18 인계분부터)도 내부적으로는 상/중/하 3단계로 계산하지만
# mlv2/attribute_quality.py의 display_final_grade가 이미 "특상"/"보통"으로 바꿔서
# 내려주므로, 두 경로 다 이 하나의 매핑을 그대로 쓰면 된다.
GRADE_MAP = {"특상": "A+", "보통": "B"}

# 품목 인식 모델의 실제 10개 클래스를 프론트(ProductItem.category: 야채/과일/수산물/정육/
# 건어물)와 같은 체계로 매핑한다. 예전엔 실측 스캔 결과에 "농수산물"이라는 존재하지 않는
# 카테고리를 그냥 박아 넣어서("배추"도 "농수산물"로 표시), 저장된 상품이 홈 피드의 카테고리
# 필터에서 아예 안 걸리는 문제가 있었다. PUBLIC_PRICE_MAP과 동일한 순서 제약 — "배"/"감"이
# "배추"/"양배추", "감귤"/"감자"의 부분 문자열이라 더 구체적인 품목명을 먼저 검사해야 한다.
def get_item_category(item_name: str) -> str:
    if "무" in item_name:
        return "야채"
    if "양배추" in item_name or "배추" in item_name:
        return "야채"
    if "양파" in item_name or "마늘" in item_name:
        return "야채"
    if "감귤" in item_name or "귤" in item_name:
        return "과일"
    if "감" in item_name and "감자" not in item_name and "감귤" not in item_name:
        return "과일"
    if "사과" in item_name or "배" in item_name:
        return "과일"
    if "감자" in item_name:
        return "야채"
    return "야채"  # 현재 인식 모델은 채소/과일류 10개 클래스만 다룬다


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

# Gemini SDK는 기본적으로 타임아웃이 없어서, 네트워크가 느리거나 응답이 없으면 요청이
# 몇 분이고 그냥 걸려 있는다 (실제로 이 환경에서 2분 가까이 걸린 적이 있었음). Gemini가
# 만들어주는 리포트(신선도/결함/종합의견)가 이 기능의 핵심이라 짧게 끊어서 폴백 문구로
# 넘어가는 것보다는 웬만하면 실제로 끝까지 기다리는 쪽을 택한다 — 대신 analyze_product/
# docent_story에서 이미 asyncio.to_thread로 별도 스레드에 넘겨두었기 때문에, 오래 걸려도
# 이 요청 하나만 느려질 뿐 서버 전체(이벤트 루프)가 멈추지는 않는다. 그래도 진짜 끊긴
# 연결에 무한정 매달리지는 않도록 상한은 둔다.
GEMINI_TIMEOUT_MS = 30_000

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
        from google.genai import types
        _gemini_client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_MS),
        )
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


_openai_client = None
_openai_client_checked = False
OPENAI_MODEL = "gpt-4o-mini"


def get_openai_client():
    """OpenAI 클라이언트를 지연 초기화한다. 키가 없거나 SDK 미설치 시 None."""
    global _openai_client, _openai_client_checked
    if _openai_client_checked:
        return _openai_client
    _openai_client_checked = True
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=api_key)
    except Exception as e:
        print(f"OpenAI 클라이언트 초기화 실패: {e}")
        _openai_client = None
    return _openai_client


def generate_openai_attribute_summary(image: Image.Image, item: str, grades: dict, final_grade: str) -> Optional[str]:
    """attribute_quality_v3가 이미 확정한 품목별 실측 속성(착색도/신선도/손상 등)과 최종
    등급은 절대 다시 매기지 않는다 — 이 함수는 그 확정된 판정을 바탕으로 사진을 참고해
    구매자에게 도움이 되는 자연스러운 문장만 새로 쓴다. 실패하면 None을 돌려줘서 호출부가
    모델이 만든 템플릿 요약(ai_scan_summary)으로 폴백하게 한다.

    `grades`는 mlv2/attribute_quality.py의 display_grade가 이미 사람이 읽는 표현(특상/상/중,
    손상·흠집은 많음/보통/적음)으로 바꿔둔 값이라 그대로 프롬프트에 써도 방향이 헷갈리지
    않는다 — 예전엔 내부 상/중/하를 그대로 넘겨서 LLM이 "하"(=손상 없음, 좋음)를 나쁘게
    서술하는 실제 오류가 있었는데, 그 번역을 이 함수가 아니라 모델 쪽에서 하도록 옮겼다.
    """
    client = get_openai_client()
    if client is None:
        return None
    try:
        buf = io.BytesIO()
        image.save(buf, format="JPEG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        grades_text = ", ".join(f"{name}: {grade}" for name, grade in grades.items())
        prompt = (
            f"이 사진 속 품목은 '{item}'입니다. 전용 비전 모델이 이미 아래처럼 속성별 상태를 "
            f"판정해 최종 등급 '{final_grade}'를 확정했습니다.\n{grades_text}\n"
            "이 판정은 이미 확정된 값이니 절대 바꾸거나 새로 매기지 말고, 그대로 반영해서 "
            "사진을 참고해 구매자에게 도움이 되는 자연스러운 한국어 종합의견을 2문장 내외로만 "
            "작성하세요. 다른 설명 없이 문장만 출력하세요."
        )
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }],
            max_tokens=200,
        )
        return (response.choices[0].message.content or "").strip() or None
    except Exception as e:
        print(f"OpenAI 종합의견 생성 실패 (템플릿 요약으로 폴백): {e}")
        return None


def generate_openai_commentary(image: Image.Image, item_name: str, grade_kor: str) -> Optional[dict]:
    """attribute_quality_v3가 지원하지 않는 품목(감자 등, 2단계 폴백 경로)에서 신선도/결함/
    균일도 세부 점수 + 종합의견을 OpenAI로 생성한다. generate_ai_commentary(Gemini)와
    입출력 계약이 같다 — 이미 확정된 품목/등급은 바꾸지 않는다."""
    client = get_openai_client()
    if client is None:
        return None
    try:
        buf = io.BytesIO()
        image.save(buf, format="JPEG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        prompt = (
            f"이 사진 속 품목은 '{item_name}'이고, 별도의 전용 분류 모델이 이미 품질 등급을 "
            f"'{grade_kor}'(특/상/보통 중 하나)로 판정했습니다. 등급 자체는 이미 확정된 값이니 "
            f"바꾸지 말고, 이 사진을 시각적으로 근거로 삼아 신선도(freshnessScore)/표면 결함 없음"
            f"(defectScore)/크기·색상 균일도(uniformityScore)를 각각 0~100 사이 정수로 추정하고, "
            f"'{grade_kor}' 등급인 이유를 설명하는 2문장 내외의 종합의견(aiAnalysisSummary)을 "
            "한국어로 작성하세요. 반드시 다음 키만 가진 JSON으로 응답하세요: "
            'freshnessScore(정수), defectScore(정수), uniformityScore(정수), aiAnalysisSummary(문자열).'
        )
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }],
            response_format={"type": "json_object"},
            max_tokens=300,
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"OpenAI 해설 생성 실패 (기존 방식으로 폴백): {e}")
        return None


# attribute_quality_v3가 내주는 품목별 속성(착색도/신선도/손상 등)을 프론트가 이미 쓰고
# 있는 3개 숫자 슬롯(freshnessScore/defectScore/uniformityScore, 0~100)에 맞춰 넣는다.
# 2026-08-18 비전팀 인계분부터 mlv2/attribute_quality.py가 내부 상/중/하를 구매자 화면용
# 표현(특상/상/중, 손상·흠집은 많음/보통/적음)으로 바꿔서 내려주므로 그 어휘 기준으로 매핑한다.
_GRADE_TO_SCORE = {"특상": 92, "상": 62, "중": 22}
# 손상·흠집은 "많음"이 나쁨이라 방향이 반대다 — defectScore는 "결함이 얼마나 있는지"
# 숫자라 많을수록 커야 한다.
_DAMAGE_TO_DEFECT_SCORE = {"적음": 8, "보통": 45, "많음": 88}


def map_attribute_labels_to_scores(item: str, labels: dict) -> tuple[int, int, int]:
    """속성 라벨(특상/상/중, 많음/보통/적음) -> (freshnessScore, defectScore, uniformityScore).

    품목마다 관련 속성 구성이 달라서(예: 무=표면상태·신선도, 마늘=모양상태), 손상은
    항상 defectScore로 쓰고, 나머지 중 가중치가 큰 순으로 2개를 freshness/uniformity에
    배정한다. 속성이 하나뿐이면(감말랭이류) 둘 다 같은 값을 쓴다.
    """
    from mlv2.attribute_final_grade import ITEM_POLICIES

    weights = ITEM_POLICIES[item].weights
    ranked = sorted((n for n in weights if n not in ("손상", "흠집")), key=lambda n: -weights[n])
    freshness_attr = ranked[0] if ranked else None
    uniformity_attr = ranked[1] if len(ranked) > 1 else freshness_attr

    freshness = _GRADE_TO_SCORE[labels[freshness_attr]["grade"]] if freshness_attr else 70
    uniformity = _GRADE_TO_SCORE[labels[uniformity_attr]["grade"]] if uniformity_attr else 70
    defect = _DAMAGE_TO_DEFECT_SCORE[labels["손상"]["grade"]]
    return freshness, defect, uniformity


def run_ai_inference(image: Image.Image) -> dict:
    """성공/농산물 미검출 모두 dict로 돌려준다 — 호출부는 result["ok"]로 분기해야 한다.
    예외(모델 로드 실패 등 진짜 오류)일 때만 None을 돌려준다."""
    if vision_pipeline is None:
        return None
    try:
        return vision_pipeline.analyze(image)
    except Exception as e:
        print(f"추론 오류: {e}")
        return None

# 피드 조회
@router.get("/api/v1/consumer/feed")
async def get_feeds(db: Session = Depends(get_db)):
    products = db.query(Product).order_by(Product.created_at.desc()).all()
    # 상품 등록 폼 자체가 "AI 스캔 필수"로 잠겨 있긴 하지만, 실제로 ai_summary/
    # attribute_labels가 둘 다 비어있는(=진짜로 스캔을 거치지 않았거나 스캔이 실패한)
    # 상품이 섞여 들어온 사례가 있었다 — 소비자 피드는 "AI가 실측 검증한 상품"이라는
    # 약속이 핵심이므로, 그 증거가 하나도 없는 상품은 여기서 한 번 더 걸러낸다.
    scanned_products = [p for p in products if p.ai_summary or p.attribute_labels]
    return [product_to_dict(p) for p in scanned_products]

# AI 스캔 (base64 이미지)
class ScanRequest(BaseModel):
    sampleId: str = "apple"
    imageBase64: Optional[str] = None

@router.post("/api/analyze-product")
async def analyze_product(request: ScanRequest):
    if request.imageBase64:
        await asyncio.to_thread(ensure_models_loaded)

    # base64 이미지 있으면 실제 모델 추론
    if request.imageBase64 and vision_pipeline is not None:
        try:
            img_data = base64.b64decode(request.imageBase64.split(",")[-1])
            image = Image.open(io.BytesIO(img_data)).convert("RGB")
            # CPU 추론 + Gemini 호출 모두 동기/블로킹이라, 스레드로 넘기지 않으면 이 요청이
            # 끝날 때까지 다른 모든 요청까지 이벤트 루프에서 같이 멈춘다.
            result = await asyncio.to_thread(run_ai_inference, image)

            if result is not None and not result.get("ok"):
                # 사진에서 농산물을 아예 못 찾은 정상적인 실패 케이스 — SCAN_MOCK으로
                # 조용히 덮지 않고 그대로 실패를 알린다. 예전에 이런 실패를 감춰서
                # 가짜 성공 결과를 보여준 적이 있어서(마늘 사건), 이번엔 정직하게 간다.
                return {
                    "success": False,
                    "reason": result.get("reason", "농산물을 인식하지 못했습니다."),
                    "hint": result.get("hint", "상품이 화면 중앙에 오도록 다시 촬영해주세요."),
                }

            if result and result.get("ok"):
                item_name = result["item"]
                grade_kor = result["grade"]  # attribute_quality_v3: "상"/"중"/"하". 폴백(감자 등): "특상"/"보통"
                confidence = result["item_conf"]
                attribute_labels = result.get("attribute_labels")

                public_price = await get_kamis_price(item_name, grade_kor)
                is_kamis_verified = public_price is not None
                if public_price is None:
                    public_price = next(
                        (v for k, v in PUBLIC_PRICE_MAP.items() if k in item_name), 10000
                    )
                cross_sell = next(
                    (v for k, v in CROSS_SELL_MAP.items() if k in item_name), DEFAULT_CROSS_SELL
                )

                if attribute_labels:
                    # attribute_quality_v3 경로 — 등급(특상/보통)은 이 모델이 실측한 값을
                    # 그대로 쓴다(다시 안 매김). 문장만 OpenAI로 더 자연스럽게 새로 쓰고,
                    # 실패하면 모델이 만든 템플릿 요약(ai_scan_summary)으로 폴백한다.
                    grade = GRADE_MAP.get(grade_kor, "A")
                    freshness, defect, uniformity = map_attribute_labels_to_scores(item_name, attribute_labels)
                    label_grades = {name: v["grade"] for name, v in attribute_labels.items()}
                    openai_summary = await asyncio.to_thread(
                        generate_openai_attribute_summary, image, item_name, label_grades, grade_kor
                    )
                    summary = openai_summary or result["ai_scan_summary"]
                    # 최종 등급을 이룬 속성들의 평균 확신도 — "등급 라벨만 보여주지 말고
                    # 확률도 같이 노출하라"는 비전팀 권고를 이 경로에서도 지킨다.
                    grade_confidence_percent = round(
                        100 * sum(v["confidence"] for v in attribute_labels.values()) / len(attribute_labels)
                    )
                else:
                    grade = GRADE_MAP.get(grade_kor, "A")
                    p_high = result["grade_p_high"]  # "특상"일 확률 — 라벨보다 이 확률이 더 정직하다
                    # 세부 점수/종합의견은 OpenAI에게 맡기고, 실패하면 Gemini로, 그마저
                    # 실패하면 기존 방식(등급확률/확신도 재활용)으로 폴백한다.
                    commentary = await asyncio.to_thread(generate_openai_commentary, image, item_name, grade_kor)
                    if commentary is None:
                        commentary = await asyncio.to_thread(generate_ai_commentary, image, item_name, grade_kor)
                    if commentary:
                        freshness = commentary["freshnessScore"]
                        defect = commentary["defectScore"]
                        uniformity = commentary["uniformityScore"]
                        summary = commentary["aiAnalysisSummary"]
                    else:
                        # 비전팀 문서 경고대로 이 등급 확률 자체가 신뢰도 낮은 지표라
                        # (grade_reliable=False), 폴백 표시값 정도로만 쓴다.
                        freshness = int(p_high * 100)
                        defect = int((1 - p_high) * 60)
                        uniformity = int(confidence * 100)
                        summary = f"AI 분석 결과 {item_name} {grade_kor}(으)로 판정되었습니다. (신뢰도: {confidence*100:.1f}%)"
                    grade_confidence_percent = round(p_high * 100 if grade_kor == "특상" else (1 - p_high) * 100)

                return {
                    "success": True,
                    "data": {
                        "productName": item_name,
                        "category": get_item_category(item_name),
                        "grade": grade,
                        "qualityScore": uniformity,
                        "sellingPrice": 0,
                        "publicMarketPrice": public_price,
                        # 카메라 실측 스캔은 실제 중량을 알 방법이 없어(비전모델은 품목/등급만
                        # 판정) KAMIS/PUBLIC_PRICE_MAP의 원/kg 값을 그대로 쓴다. SCAN_MOCK
                        # 경로처럼 pack_weight_kg를 곱해 "1단/2kg" 단위로 환산하지 못하므로,
                        # 프론트가 "(1kg 기준)"이라고 정직하게 표시할 수 있도록 단위를 알려준다.
                        "publicPriceUnit": "kg",
                        "priceDiffPercent": 0,
                        "priceTrafficLight": "SAFE",
                        "freshnessScore": freshness,
                        "defectScore": defect,
                        "uniformityScore": uniformity,
                        # 실제 CV 모델이 측정한 품목별 속성(착색도/신선도/손상 등) 원본 —
                        # 있으면 프론트가 freshness/defect/uniformity로 뭉갠 숫자 대신 이
                        # 진짜 속성명+상/중/하를 그대로 보여준다. 감자 등 미지원 품목/
                        # 2단계 폴백 경로는 None.
                        "attributeLabels": attribute_labels,
                        "publicGuarantee": (
                            "농산물유통정보(KAMIS) 소매가격 실시간 연동"
                            if is_kamis_verified
                            else "참고 시세 (KAMIS 데이터 없음 — 자체 추정치)"
                        ),
                        "aiAnalysisSummary": summary,
                        "crossSellRecommendation": cross_sell,
                        # 비전팀 문서 권고: 등급 라벨만 크게 보여주면 안 되고 확률을 같이
                        # 노출해야 정직하다("특상 53%"와 "특상 99%"가 같아 보이면 안 됨).
                        "gradeConfidencePercent": grade_confidence_percent,
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
    kamis_unit_price = await get_kamis_price(kamis_config["item"], data["grade"]) if kamis_config else None
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


def _generate_openai_text(prompt: str, temperature: float = 1.0) -> Optional[str]:
    """텍스트 전용(이미지 없음) OpenAI 호출 공통 헬퍼 — 도슨트 등 짧은 문장 생성용."""
    client = get_openai_client()
    if client is None:
        return None
    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=300,
        )
        return (response.choices[0].message.content or "").strip() or None
    except Exception as e:
        print(f"OpenAI 텍스트 생성 실패: {e}")
        return None


def generate_docent_script_for_store(market_name: str, store: Store) -> str:
    """클릭한 '그 점포 하나'에 대한 도슨트를 생성한다 (구역 전체가 아니라).
    OpenAI를 우선 쓰고, 실패하면 Gemini로, 그마저 실패하면 같은 점포 데이터로 만든
    템플릿 문장으로 폴백한다.
    """
    # store.subtitle이 상인이 마이 탭에서 고른 실제 "주요 품목"
    # (예: "수산물(고등어·갈치) / 건어물(멸치)") 이라 이걸 최우선으로 쓴다.
    # notice는 상인이 입력할 수 있는 곳이 없어 항상 비어 있고, category는 지도 핀
    # 아이콘용 기본값("store")이라 실제 품목 정보가 아니다 — 둘 다 최후 폴백일 뿐이다.
    highlight = store.subtitle or store.notice or store.category

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

    text = _generate_openai_text(prompt, temperature=1.1)

    if not text:
        client = get_gemini_client()
        if client is not None:
            try:
                from google.genai import types

                response = client.models.generate_content(
                    model="gemini-3.6-flash",
                    contents=[prompt],
                    config=types.GenerateContentConfig(temperature=1.1),
                )
                text = (response.text or "").strip() or None
            except Exception as e:
                print(f"Gemini 도슨트 생성 실패 (템플릿으로 폴백): {e}")

    if text:
        return f'"{text}"'
    return f'"{store.name}에 오신 것을 환영합니다. {highlight}을(를) 만나보세요."'


def generate_docent_script(market_name: str, alley_name: str, stores: list[Store]) -> str:
    """실제 DB 점포 데이터를 근거로 도슨트 해설을 생성한다.
    OpenAI를 우선 쓰고, 실패하면 Gemini로, 그마저 실패하면 같은 데이터로 만든 템플릿
    문장으로 폴백한다.
    """
    highlights = [f"{s.name}({s.subtitle})" if s.subtitle else s.name for s in stores[:4]]

    text = None
    if highlights:
        prompt = (
            f"당신은 전통시장 오디오 도슨트 해설자입니다. '{market_name}' 안의 '{alley_name}' 구역을 "
            f"둘러보는 손님에게 들려줄 자연스러운 한국어 해설을 2~3문장으로 작성하세요. "
            f"이 구역에는 다음 실제 점포들이 있습니다: {', '.join(highlights)}. "
            f"실제 점포명과 취급 품목을 자연스럽게 언급하며 친근하고 생동감 있는 구어체로 "
            f"작성하고, 없는 사실을 지어내지 마세요. 따옴표로 감싸지 마세요."
        )
        text = _generate_openai_text(prompt)

        if not text:
            client = get_gemini_client()
            if client is not None:
                try:
                    response = client.models.generate_content(
                        model="gemini-3.6-flash",
                        contents=[prompt],
                    )
                    text = (response.text or "").strip() or None
                except Exception as e:
                    print(f"Gemini 도슨트 생성 실패 (템플릿으로 폴백): {e}")

    if text:
        return f'"{text}"'
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
            # 캐시 미스면 안에서 Gemini를 동기 호출하므로, 스레드로 넘겨 이벤트 루프를 막지 않는다.
            script = await asyncio.to_thread(
                _cached_or_generate,
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
    script = await asyncio.to_thread(
        _cached_or_generate,
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