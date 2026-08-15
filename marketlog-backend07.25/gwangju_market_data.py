"""Loads the public-data CSV of Gwangju Yangdong-market stores into Store rows.

Source: 광주광역시 전통시장 점포 현황 (공공데이터포털, 2021-11-19 기준).
Used by seed.py (fresh DB) and import_gwangju_stores.py (refresh an existing DB).
"""
import csv
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
CSV_PATH = os.path.join(DATA_DIR, "gwangju_market_stores_20211119.csv")
MARKET_ID = "yangdong"

# 분류(raw CSV category) -> (category key, icon, badge color, badge label)
# 배지색은 전부 브랜드 블루로 통일한다 — 지도에서 "강조(포커스)" 마커만 빨간색을 쓰는데,
# 카테고리별로 색이 다르면 특정 카테고리(예전엔 정육점=빨강)가 강조색과 겹쳐서 항상
# 강조된 것처럼 보이는 문제가 있었다. 아이콘/카테고리명으로 이미 구분되므로 색 구분은
# "강조 여부" 하나에만 쓴다.
_BRAND_BLUE = "#0052FF"
CATEGORY_MAP = {
    "수산물": ("fish", "set_meal", _BRAND_BLUE, "수산"),
    "채소": ("vegetable", "eco", _BRAND_BLUE, "채소"),
    "채소가게": ("vegetable", "eco", _BRAND_BLUE, "채소"),
    "야채도소매": ("vegetable", "eco", _BRAND_BLUE, "채소"),
    "정육점": ("meat", "kebab_dining", _BRAND_BLUE, "정육"),
    "카페": ("cafe", "local_cafe", _BRAND_BLUE, "카페"),
    "음식점": ("food", "restaurant", _BRAND_BLUE, "음식"),
    "도소매": ("store", "storefront", _BRAND_BLUE, "도소매"),
    "소매": ("store", "storefront", _BRAND_BLUE, "도소매"),
    "도소메": ("store", "storefront", _BRAND_BLUE, "도소매"),
}
DEFAULT_CATEGORY = ("store", "storefront", _BRAND_BLUE, "기타")


def load_yangdong_stores(csv_path: str = CSV_PATH) -> list[dict]:
    stores = []
    seen_ids: set[str] = set()

    with open(csv_path, encoding="cp949") as f:
        for row in csv.DictReader(f):
            name = (row.get("점포명") or "").strip()
            raw_lat, raw_lng = row.get("위도"), row.get("경도")
            if not name or not raw_lat or not raw_lng:
                continue

            try:
                lat, lng = float(raw_lat), float(raw_lng)
            except ValueError:
                continue

            raw_category = (row.get("분류") or "").strip()
            category, icon, badge_color, grade = CATEGORY_MAP.get(raw_category, DEFAULT_CATEGORY)

            main_product = (row.get("주력상품") or "").strip()
            items = (row.get("취급품목") or "").strip()
            subtitle = main_product or items or raw_category or "전통시장 점포"
            notice = items or main_product or raw_category or "전통시장 점포"

            sub_market = (row.get("시장명") or "").strip() or "양동시장"
            address = (row.get("소재지도로명주소") or row.get("소재지지번주소") or "").strip()
            phone = (row.get("전화번호") or "").strip()

            story_parts = [f"{name}은(는) {sub_market}에 위치한 점포로, {items or raw_category}을(를) 취급합니다."]
            if address:
                story_parts.append(f"주소: {address}")
            if phone:
                story_parts.append(f"문의: {phone}")

            store_id = f"csv_{(row.get('점포(ID)') or '').strip() or name}"
            if store_id in seen_ids:
                store_id = f"{store_id}_{len(seen_ids)}"
            seen_ids.add(store_id)

            stores.append({
                "id": store_id,
                "market_id": MARKET_ID,
                "name": name,
                "subtitle": subtitle,
                "lat": lat,
                "lng": lng,
                "category": category,
                "icon": icon,
                "badge_color": badge_color,
                "grade": grade,
                "notice": notice,
                "notice_time": "",
                "alley": sub_market,
                "story_text": " ".join(story_parts),
            })

    return stores
