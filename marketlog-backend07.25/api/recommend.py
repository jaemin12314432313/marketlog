from fastapi import APIRouter

router = APIRouter(tags=["Recommend & Map"])

# 연관분석 추천
RECOMMEND_RULES = {
    "삼겹살": {
        "base_item": "삼겹살",
        "recommend_store": "호남상회 (40m 앞)",
        "recommend_item": "쌈채소 세트",
        "coupon_message": "삼겹살 사셨네요! 호남상회 쌈채소 15% 할인쿠폰이 발급되었습니다."
    },
    "은갈치": {
        "base_item": "은갈치",
        "recommend_store": "호남상회 (50m 앞)",
        "recommend_item": "가을무",
        "coupon_message": "은갈치 사셨네요! 호남상회 가을무 20% 할인쿠폰이 발급되었습니다."
    },
    "딸기": {
        "base_item": "딸기",
        "recommend_store": "싱싱청과 (30m 앞)",
        "recommend_item": "수제 생크림",
        "coupon_message": "딸기 사셨네요! 싱싱청과 생크림 10% 할인쿠폰이 발급되었습니다."
    }
}

@router.get("/api/v1/recommend")
async def get_recommendation(item: str = "삼겹살"):
    for key in RECOMMEND_RULES:
        if key in item:
            return RECOMMEND_RULES[key]
    return RECOMMEND_RULES["삼겹살"]