"""Loads public-data CSVs of Gwangju traditional-market stores into Store rows.

Source: 광주광역시 전통시장 점포 현황 (공공데이터포털, 2021-11-19 기준) — the full
provincial file covers all 26 Gwangju markets; each market's Store rows are loaded
from its own pre-filtered CSV in data/ (see load_yangdong_stores/load_malbawi_stores).
Used by seed.py (fresh DB) and import_gwangju_stores.py/import_malbawi_stores.py
(refresh an existing DB).
"""
import csv
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# 분류(raw CSV category) -> (category key, icon, badge color, badge label)
# 배지색은 전부 브랜드 블루로 통일한다 — 지도에서 "강조(포커스)" 마커만 빨간색을 쓰는데,
# 카테고리별로 색이 다르면 특정 카테고리(예전엔 정육점=빨강)가 강조색과 겹쳐서 항상
# 강조된 것처럼 보이는 문제가 있었다. 아이콘/카테고리명으로 이미 구분되므로 색 구분은
# "강조 여부" 하나에만 쓴다.
_BRAND_BLUE = "#0052FF"
CATEGORY_MAP = {
    "수산물": ("fish", "set_meal", _BRAND_BLUE, "수산"),
    "건어물": ("fish", "set_meal", _BRAND_BLUE, "건어물"),
    "채소": ("vegetable", "eco", _BRAND_BLUE, "채소"),
    "채소가게": ("vegetable", "eco", _BRAND_BLUE, "채소"),
    "야채도소매": ("vegetable", "eco", _BRAND_BLUE, "채소"),
    "정육점": ("meat", "kebab_dining", _BRAND_BLUE, "정육"),
    "식육점": ("meat", "kebab_dining", _BRAND_BLUE, "정육"),
    "식유점": ("meat", "kebab_dining", _BRAND_BLUE, "정육"),  # 원본 CSV 오타(식육점)
    "축산물": ("meat", "kebab_dining", _BRAND_BLUE, "정육"),
    "축산": ("meat", "kebab_dining", _BRAND_BLUE, "정육"),
    "쇼핑, 유통, 정육점": ("meat", "kebab_dining", _BRAND_BLUE, "정육"),
    "닭집": ("meat", "kebab_dining", _BRAND_BLUE, "닭"),
    "카페": ("cafe", "local_cafe", _BRAND_BLUE, "카페"),
    "음식점": ("food", "restaurant", _BRAND_BLUE, "음식"),
    "음식": ("food", "restaurant", _BRAND_BLUE, "음식"),
    "식당": ("food", "restaurant", _BRAND_BLUE, "식당"),
    "분식": ("food", "restaurant", _BRAND_BLUE, "분식"),
    "반찬": ("food", "restaurant", _BRAND_BLUE, "반찬"),
    "떡집": ("food", "restaurant", _BRAND_BLUE, "떡"),
    "빵집": ("food", "restaurant", _BRAND_BLUE, "빵"),
    "도소매": ("vegetable", "storefront", _BRAND_BLUE, "식료품"),
    "소매": ("vegetable", "storefront", _BRAND_BLUE, "식료품"),
    "도소메": ("vegetable", "storefront", _BRAND_BLUE, "식료품"),
    "소매/유통": ("vegetable", "storefront", _BRAND_BLUE, "식료품"),
}
DEFAULT_CATEGORY = ("vegetable", "storefront", _BRAND_BLUE, "식료품")


def load_market_stores(
    csv_path: str,
    market_id: str,
    id_prefix: str = "csv",
    encoding: str = "cp949",
    fallback_sub_market: str = "",
    exclude_categories: set[str] | None = None,
) -> list[dict]:
    """CSV 한 줄(점포 하나)을 Store 행 하나로 바꾼다 — 시장마다 데이터 파일은 다르지만
    컬럼 구조(점포명/분류/위도/경도/주소/전화번호 등)는 공공데이터포털 원본 그대로라
    로직은 공유한다."""
    stores = []
    seen_ids: set[str] = set()

    with open(csv_path, encoding=encoding) as f:
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
            if exclude_categories and category in exclude_categories:
                continue

            main_product = (row.get("주력상품") or "").strip()
            items = (row.get("취급품목") or "").strip()
            subtitle = main_product or items or raw_category or "전통시장 점포"
            notice = items or main_product or raw_category or "전통시장 점포"

            sub_market = (row.get("시장명") or "").strip() or fallback_sub_market
            address = (row.get("소재지도로명주소") or row.get("소재지지번주소") or "").strip()
            phone = (row.get("전화번호") or "").strip()

            story_parts = [f"{name}은(는) {sub_market}에 위치한 점포로, {items or raw_category}을(를) 취급합니다."]
            if address:
                story_parts.append(f"주소: {address}")
            if phone:
                story_parts.append(f"문의: {phone}")

            store_id = f"{id_prefix}_{(row.get('점포(ID)') or '').strip() or name}"
            if store_id in seen_ids:
                store_id = f"{store_id}_{len(seen_ids)}"
            seen_ids.add(store_id)

            stores.append({
                "id": store_id,
                "market_id": market_id,
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


# --- 양동시장 (기존 시드 데이터 — seed.py가 참조하므로 이름/시그니처 그대로 유지) ---
CSV_PATH = os.path.join(DATA_DIR, "gwangju_market_stores_20211119.csv")
MARKET_ID = "yangdong"


def load_yangdong_stores(csv_path: str = CSV_PATH) -> list[dict]:
    # 사용자 요청: 양동시장에서 음식점류(음식점/음식/식당/분식/반찬/떡집/빵집 — CATEGORY_MAP상
    # 전부 category="food")는 일단 다 제외한다. 카페는 별도 category("cafe")라 안 건드림.
    # 말바우시장은 아직 이 필터를 적용하지 않는다(요청 범위가 양동시장으로 한정됨).
    return load_market_stores(
        csv_path, MARKET_ID, id_prefix="csv", fallback_sub_market="양동시장",
        exclude_categories={"food"},
    )


# --- 말바우시장 ---
MALBAWI_CSV_PATH = os.path.join(DATA_DIR, "malbawi_market_stores_20211119.csv")
MALBAWI_MARKET_ID = "malbawi"


def load_malbawi_stores(csv_path: str = MALBAWI_CSV_PATH) -> list[dict]:
    return load_market_stores(
        csv_path, MALBAWI_MARKET_ID, id_prefix="csv_malbawi", encoding="utf-8-sig", fallback_sub_market="말바우시장"
    )
