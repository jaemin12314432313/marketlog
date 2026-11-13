"""CO-SHOW 2026 전시 부스 전용 API.

부스 체험 흐름(공용 태블릿 → 대형 모니터 → 관람객 개인 폰 QR)에만 쓰인다.
- 관람객은 회원가입/로그인 없이 가게 이름만 입력하고 바로 상품을 등록한다.
- 부스 데이터는 전부 "coshow" 가상 시장에 묶여서, 기존 양동시장 데이터/소비자 피드와 섞이지 않는다.
- 공용 기기라 부적절한 가게 이름은 서버에서 한 번 더 걸러내고, 스태프가 관리 키로 숨길 수 있다.
"""
import asyncio
import base64
import json
import math
import os
import re
from collections import Counter
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db import get_db
from models import BoothEvent, BoothShop, Market, Product, Store, User, gen_uuid, product_to_dict
from api.auth import create_access_token, hash_password, serialize_user
from image_storage import upload_base64_image
from api.consumer import _cached_or_generate, _generate_openai_text, ensure_models_loaded, get_gemini_client
import api.consumer as consumer_module
from api.merchant import _generate_product_copy

router = APIRouter(prefix="/api/v1/booth", tags=["Booth"])

BOOTH_MARKET_ID = "coshow"
# 김대중컨벤션센터(광주 서구 상무누리로 30) — 가상 시장 지도의 중심
BOOTH_CENTER = (35.1467, 126.8402)
KST = timedelta(hours=9)

# ---------- 가게 이름 검사 ----------

# 공용 태블릿에서 입력한 이름이 대형 모니터에 바로 뜨므로, 흔한 비속어/성적 표현을 막는다.
# 공백·특수문자를 지운 뒤 비교해서 "시 발", "시.발" 같은 우회도 함께 걸러낸다.
_BANNED_WORDS = [
    "시발", "씨발", "씨바", "시바", "ㅅㅂ", "ㅆㅂ", "병신", "븅신", "ㅂㅅ", "좆", "존나", "졸라",
    "개새", "개색", "새끼", "섹스", "sex", "fuck", "shit", "bitch", "보지", "자지", "니미", "느금",
    "애미", "애비", "엠창", "꺼져", "닥쳐", "지랄", "ㅈㄹ", "염병", "미친놈", "미친년", "또라이",
    "일베", "한남", "김치녀", "장애인", "틀딱", "운지", "노무",
]
_NAME_STRIP_RE = re.compile(r"[\s\W_]+", re.UNICODE)
MAX_SHOP_NAME_LENGTH = 12


def check_shop_name(raw: str) -> str:
    """정리된 가게 이름을 돌려주고, 쓸 수 없으면 400 에러를 낸다."""
    name = re.sub(r"\s+", " ", (raw or "").strip())
    if not name:
        raise HTTPException(status_code=400, detail="가게 이름을 입력해주세요.")
    if len(name) > MAX_SHOP_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"가게 이름은 {MAX_SHOP_NAME_LENGTH}자 이내로 입력해주세요.")
    compact = _NAME_STRIP_RE.sub("", name).lower()
    if not compact:
        raise HTTPException(status_code=400, detail="글자가 들어간 가게 이름을 입력해주세요.")
    if any(word in compact for word in _BANNED_WORDS):
        raise HTTPException(status_code=400, detail="모두가 보는 화면에 올라가는 이름이에요. 다른 이름을 입력해주세요.")
    return name


MAX_TAGLINE_LENGTH = 30


def check_tagline(raw: str) -> str | None:
    """우리 가게 한마디(선택). QR 페이지와 저장 이미지에 그대로 나가므로 가게 이름과 같은 금칙어 검사를 한다."""
    text = re.sub(r"\s+", " ", (raw or "").strip())
    if not text:
        return None
    if len(text) > MAX_TAGLINE_LENGTH:
        raise HTTPException(status_code=400, detail=f"가게 한마디는 {MAX_TAGLINE_LENGTH}자 이내로 적어주세요.")
    compact = _NAME_STRIP_RE.sub("", text).lower()
    if any(word in compact for word in _BANNED_WORDS):
        raise HTTPException(status_code=400, detail="모두가 보는 화면에 올라가는 한마디예요. 다른 말로 적어주세요.")
    return text


class NameCheckRequest(BaseModel):
    shopName: str


@router.post("/check-name")
def check_name(payload: NameCheckRequest):
    return {"success": True, "shopName": check_shop_name(payload.shopName)}


# ---------- 서버 예열 ----------

@router.get("/lan-ip")
def booth_lan_ip():
    """로컬 테스트용: 이 서버 PC의 내부 네트워크 IP. 화면을 localhost로 열었을 때 QR에 폰이
    접속할 수 있는 주소를 넣기 위해 쓴다(실제 배포 서버에서는 화면 주소를 그대로 쓰므로 안 쓴다)."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))  # 실제로 패킷을 보내지는 않고, 나가는 네트워크 카드의 IP만 얻는다
            return {"ip": sock.getsockname()[0]}
    except OSError:
        return {"ip": None}


@router.get("/warmup")
async def warmup():
    """태블릿이 켜질 때 호출해서 AI 모델(약 180MB)을 미리 올려둔다 — 첫 관람객이
    모델 로딩 시간(수십 초)을 기다리지 않게 하기 위함. 로딩은 백그라운드로 돌리고 바로 응답한다."""
    if not consumer_module._models_load_attempted:
        asyncio.create_task(asyncio.to_thread(ensure_models_loaded))
    return {
        "success": True,
        "modelsLoaded": consumer_module.vision_pipeline is not None,
        "loading": consumer_module._models_load_attempted and consumer_module.vision_pipeline is None,
    }


# ---------- AI 홍보 문구 ----------

class BoothCopyRequest(BaseModel):
    title: str
    category: str = "과일"
    shopName: str = ""


_FALLBACK_COPY = {
    "descriptions": [
        "AI가 직접 확인한 오늘의 신선한 {title}",
        "한 입 베어 물면 느껴지는 제철 {title}의 맛",
        "사진 한 장으로 품질을 증명한 정직한 {title}",
    ],
    "hashtags": ["#마켓로그", "#AI품질인증", "#제철과일", "#CO_SHOW", "#전통시장"],
}


@router.post("/product-copy")
async def booth_product_copy(payload: BoothCopyRequest, db: Session = Depends(get_db)):
    market = db.query(Market).filter(Market.id == BOOTH_MARKET_ID).first()
    result = await asyncio.to_thread(_generate_product_copy, payload.title, payload.category, None, market)
    if not result:
        # AI 호출이 모두 실패해도 체험이 끊기지 않도록 기본 문구를 내려준다.
        return {
            "success": True,
            "isFallback": True,
            "descriptions": [d.format(title=payload.title) for d in _FALLBACK_COPY["descriptions"]],
            "hashtags": _FALLBACK_COPY["hashtags"],
        }
    hashtags = [t if t.startswith("#") else f"#{t}" for t in result["hashtags"]]
    return {"success": True, "isFallback": False, "descriptions": result["descriptions"][:3], "hashtags": hashtags[:5]}


# ---------- 상품 등록 (가게 개설 + 진열을 한 번에) ----------

class BoothRegisterRequest(BaseModel):
    shopName: str
    title: str
    category: str = "과일"
    unit: str = "1kg"
    price: int = Field(gt=0, le=1_000_000)
    publicPrice: int = Field(0, ge=0)
    grade: str = "A"
    imageBase64: str
    freshnessScore: int = 0
    defectScore: int = 0
    uniformityScore: int = 0
    attributeLabels: dict | None = None
    aiSummary: str | None = None
    gradeConfidencePercent: int | None = None
    description: str = ""
    tags: list[str] = []


def _stall_position(number: int) -> tuple[float, float]:
    """가게 번호 → 지도 좌표. 해바라기 씨앗 배치(황금각 나선)로 컨벤션센터를 중심으로
    고르게 퍼뜨린다 — 가게가 수백 개로 늘어나도 겹치지 않고 자연스럽게 바깥으로 자란다."""
    golden_angle = 2.399963  # 약 137.5도
    # +3: 1번 가게부터 중심(부스 위치 표시)과 겹치지 않도록 살짝 바깥에서 시작한다.
    radius_deg = 0.00009 * ((number + 3) ** 0.5)
    theta = number * golden_angle
    lat = BOOTH_CENTER[0] + radius_deg * 0.82 * math.sin(theta)
    lng = BOOTH_CENTER[1] + radius_deg * math.cos(theta)
    return lat, lng


def _price_tag(price: int, public_price: int) -> str:
    if not public_price:
        return ""
    diff = round((public_price - price) / public_price * 100)
    if diff > 0:
        return f"공공 시세 대비 {diff}% 저렴"
    if diff < 0:
        return f"공공 시세 대비 {-diff}% 비쌈"
    return "공공 시세와 동일"


def _confidence_percent(payload: BoothRegisterRequest) -> int | None:
    if payload.gradeConfidencePercent is not None:
        return payload.gradeConfidencePercent
    labels = payload.attributeLabels or {}
    values = [v.get("confidence") for v in labels.values() if isinstance(v, dict) and v.get("confidence") is not None]
    return round(100 * sum(values) / len(values)) if values else None


def _create_booth_shop(db: Session, shop_name: str, item_name: str = "", grade: str = "A") -> tuple[Store, BoothShop]:
    """가게 번호는 지금까지의 최댓값 + 1. 태블릿 여러 대가 동시에 등록하면 번호가 겹칠 수
    있어서, 고유 제약에 걸리면 다시 번호를 받아 몇 번 재시도한다."""
    for _ in range(5):
        number = (db.query(func.max(BoothShop.number)).scalar() or 0) + 1
        lat, lng = _stall_position(number)
        grade_text = "특상" if grade == "A+" else "보통"
        store = Store(
            market_id=BOOTH_MARKET_ID,
            name=shop_name,
            subtitle=f"{item_name} · AI 판정 {grade_text}" if item_name else "AI 품질 인증 과일가게",
            lat=lat,
            lng=lng,
            category="booth",
            icon="storefront",
            badge_color="#0052FF",
            grade=grade,
            alley="김대중컨벤션센터 마켓로그 부스",
            story_text=(
                f"CO-SHOW 2026 마켓로그 부스에서 관람객이 직접 문을 연 {number}번째 가게입니다. "
                + (f"사진 한 장으로 {item_name}의 품질을 AI가 판정했고, 결과는 {grade_text} 등급이었습니다." if item_name else "사진 한 장으로 과일 품질을 AI가 판정해 진열합니다.")
            ),
            # 상인 상품 등록은 전화번호·영업시간이 있어야 허용되므로 부스 가게는 미리 채워 둔다.
            phone="마켓로그 부스 현장 문의",
            hours="CO-SHOW 전시 기간",
            address="광주광역시 서구 상무누리로 30 김대중컨벤션센터",
        )
        db.add(store)
        db.flush()
        shop = BoothShop(store_id=store.id, number=number)
        db.add(shop)
        try:
            db.flush()
            return store, shop
        except IntegrityError:
            db.rollback()
    raise HTTPException(status_code=503, detail="잠시 후 다시 시도해주세요.")


# 관람객 유형(익명 통계용). 화면의 선택 칩과 같은 값이어야 한다.
VISITOR_TYPES = ["초등학생", "중고등학생", "대학생", "일반", "교사·기관", "기업"]


class OpenShopRequest(BaseModel):
    shopName: str
    visitorType: str = ""
    affiliation: str = ""  # 소속(선택)
    tagline: str = ""  # 우리 가게 한마디(선택)


@router.post("/open-shop")
def booth_open_shop(payload: OpenShopRequest, db: Session = Depends(get_db)):
    """앱 부스 모드: 관람객이 가게 이름을 정하면 CO-SHOW 가상 시장에 가게와 임시 상인 계정을
    만들고 바로 로그인 토큰을 준다. 이후 상품 등록은 기존 상인 화면/API를 그대로 쓴다."""
    shop_name = check_shop_name(payload.shopName)
    if payload.visitorType not in VISITOR_TYPES:
        raise HTTPException(status_code=400, detail="어떤 분인지 하나 골라주세요.")
    tagline = check_tagline(payload.tagline)
    # 상인 API는 (시장, 가게 이름)으로 점포를 찾기 때문에 같은 시장 안에서 이름이 겹치면 안 된다.
    if db.query(Store).filter(Store.market_id == BOOTH_MARKET_ID, Store.name == shop_name).first():
        raise HTTPException(status_code=409, detail="이미 같은 이름의 가게가 있어요. 다른 이름을 지어주세요.")
    store, shop = _create_booth_shop(db, shop_name)
    shop.visitor_type = payload.visitorType
    shop.tagline = tagline
    shop.affiliation = re.sub(r"\s+", " ", (payload.affiliation or "").strip())[:30] or None
    user = User(
        username=f"booth{shop.number}-{gen_uuid()[:8]}",
        password_hash=hash_password(gen_uuid()),
        role="merchant",
        display_name=shop_name,
        phone="",
        shop_name=shop_name,
        market_id=BOOTH_MARKET_ID,
    )
    db.add(user)
    db.add(BoothEvent(type="open_shop", detail=shop_name))
    db.commit()
    db.refresh(user)
    return {
        "success": True,
        "token": create_access_token(user.id),
        "user": serialize_user(user),
        "shopNumber": shop.number,
        "storeId": store.id,
    }


@router.post("/enter-shop")
def booth_enter_shop(payload: OpenShopRequest, db: Session = Depends(get_db)):
    """이미 열린 부스 가게로 다시 들어간다(같은 이름으로 가게 열기를 눌렀을 때 이어서 하기)."""
    shop_name = (payload.shopName or "").strip()
    store = db.query(Store).filter(Store.market_id == BOOTH_MARKET_ID, Store.name == shop_name).first()
    shop = db.query(BoothShop).filter(BoothShop.store_id == store.id).first() if store else None
    if not store or not shop or shop.hidden:
        raise HTTPException(status_code=404, detail="가게를 찾을 수 없어요.")
    # 다시 들어올 때 한마디를 새로 적었으면 바꿔 준다(비워 두면 기존 한마디 유지).
    new_tagline = check_tagline(payload.tagline)
    if new_tagline:
        shop.tagline = new_tagline
    user = (
        db.query(User)
        .filter(User.role == "merchant", User.market_id == BOOTH_MARKET_ID, User.shop_name == shop_name)
        .first()
    )
    # 태블릿 체험 웹으로 만든 가게는 계정이 없으니, 이때 하나 만들어 붙인다.
    if not user:
        user = User(
            username=f"booth{shop.number}-{gen_uuid()[:8]}",
            password_hash=hash_password(gen_uuid()),
            role="merchant",
            display_name=shop_name,
            phone="",
            shop_name=shop_name,
            market_id=BOOTH_MARKET_ID,
        )
        db.add(user)
    if not (store.phone or "").strip():
        store.phone = "마켓로그 부스 현장 문의"
    if not (store.hours or "").strip():
        store.hours = "CO-SHOW 전시 기간"
    db.add(BoothEvent(type="enter_shop", detail=shop_name))
    db.commit()
    db.refresh(user)
    return {
        "success": True,
        "token": create_access_token(user.id),
        "user": serialize_user(user),
        "shopNumber": shop.number,
        "storeId": store.id,
    }


@router.post("/register")
async def booth_register(payload: BoothRegisterRequest, db: Session = Depends(get_db)):
    shop_name = check_shop_name(payload.shopName)
    if not payload.imageBase64.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="촬영한 사진이 없습니다. 다시 촬영해주세요.")

    # GCS 업로드는 네트워크 호출이라 이벤트 루프를 막지 않게 스레드로 넘긴다.
    image_url = await asyncio.to_thread(upload_base64_image, payload.imageBase64, "booth")
    market = db.query(Market).filter(Market.id == BOOTH_MARKET_ID).first()

    store, shop = _create_booth_shop(db, shop_name, payload.title, payload.grade)
    tags = ",".join(t if t.startswith("#") else f"#{t}" for t in payload.tags[:5] if t.strip())
    attribute_labels = dict(payload.attributeLabels or {})
    confidence = _confidence_percent(payload)

    product = Product(
        id=gen_uuid(),
        market_id=BOOTH_MARKET_ID,
        store_id=store.id,
        region="광주광역시",
        title=payload.title,
        unit=payload.unit,
        origin="",  # 소비자 피드가 원산지를 상품명 앞에 [ ]로 붙여 보여주므로 비워둔다
        tags=tags,
        shop_name=shop_name,
        distance=market.name if market else "CO-SHOW 가상 시장",
        time_ago="방금 전",
        price=payload.price,
        public_price=payload.publicPrice,
        price_tag=_price_tag(payload.price, payload.publicPrice),
        grade=payload.grade,
        category=payload.category if payload.category in ("야채", "과일") else "과일",
        image_url=image_url,
        freshness_score=payload.freshnessScore,
        defect_score=payload.defectScore,
        uniformity_score=payload.uniformityScore,
        attribute_labels=json.dumps(attribute_labels, ensure_ascii=False) if attribute_labels else None,
        description=payload.description[:200],
        ai_summary=payload.aiSummary,
        is_scanned_product=True,
        is_merchant_uploaded=True,
    )
    db.add(product)
    db.add(BoothEvent(type="register", product_id=product.id))
    db.commit()
    db.refresh(product)

    return {
        "success": True,
        "product": _booth_product_dict(product, shop.number, confidence),
        "shopNumber": shop.number,
    }


# ---------- 조회 (대형 모니터 / QR 결과 페이지) ----------

def _booth_product_dict(product: Product, number: int | None, confidence: int | None = None) -> dict:
    data = product_to_dict(product)
    data["shopNumber"] = number
    if confidence is None and data.get("attributeLabels"):
        values = [v.get("confidence") for v in data["attributeLabels"].values() if isinstance(v, dict)]
        values = [v for v in values if v is not None]
        confidence = round(100 * sum(values) / len(values)) if values else None
    data["gradeConfidencePercent"] = confidence
    return data


def _today_kst() -> datetime:
    """오늘(한국 시간) 0시를 DB 기준(naive UTC)으로 돌려준다."""
    now_kst = datetime.utcnow() + KST
    return datetime(now_kst.year, now_kst.month, now_kst.day) - KST


def _visible_booth_products(db: Session):
    return (
        db.query(Product, BoothShop.number)
        .join(BoothShop, BoothShop.store_id == Product.store_id)
        .filter(Product.market_id == BOOTH_MARKET_ID, BoothShop.hidden.is_(False))
    )


@router.get("/feed")
def booth_feed(limit: int = 20, db: Session = Depends(get_db)):
    """대형 모니터용 — 최신 상품, 지도 핀, 누적 통계를 한 번에 내려준다(몇 초마다 폴링)."""
    limit = max(1, min(limit, 50))
    rows = _visible_booth_products(db).order_by(Product.created_at.desc()).limit(limit).all()
    products = [_booth_product_dict(p, n) for p, n in rows]

    pin_rows = (
        db.query(Store.id, Store.name, Store.lat, Store.lng, Store.grade, BoothShop.number)
        .join(BoothShop, BoothShop.store_id == Store.id)
        .filter(Store.market_id == BOOTH_MARKET_ID, BoothShop.hidden.is_(False))
        .order_by(BoothShop.number.desc())
        .limit(400)
        .all()
    )
    pins = [
        {"storeId": sid, "name": name, "lat": lat, "lng": lng, "grade": grade, "number": number}
        for sid, name, lat, lng, grade, number in pin_rows
    ]

    total_products = _visible_booth_products(db).count()
    today_products = _visible_booth_products(db).filter(Product.created_at >= _today_kst()).count()
    premium = _visible_booth_products(db).filter(Product.grade == "A+").count()
    item_counts = Counter(title for (title,) in (
        db.query(Product.title)
        .join(BoothShop, BoothShop.store_id == Product.store_id)
        .filter(Product.market_id == BOOTH_MARKET_ID, BoothShop.hidden.is_(False))
        .all()
    ))
    qr_views = db.query(BoothEvent).filter(BoothEvent.type == "result_view").count()

    return {
        "success": True,
        "center": {"lat": BOOTH_CENTER[0], "lng": BOOTH_CENTER[1]},
        "products": products,
        "pins": pins,
        "stats": {
            "totalShops": db.query(BoothShop).filter(BoothShop.hidden.is_(False)).count(),
            "totalProducts": total_products,
            "todayProducts": today_products,
            "premiumPercent": round(100 * premium / total_products) if total_products else 0,
            "itemCounts": dict(item_counts.most_common(6)),
            "qrViews": qr_views,
        },
    }


def _load_booth_product(db: Session, product_id: str) -> tuple[Product, BoothShop]:
    row = (
        db.query(Product, BoothShop)
        .join(BoothShop, BoothShop.store_id == Product.store_id)
        .filter(Product.id == product_id, Product.market_id == BOOTH_MARKET_ID)
        .first()
    )
    if not row or row[1].hidden:
        raise HTTPException(status_code=404, detail="가게를 찾을 수 없습니다.")
    return row


@router.get("/result/{product_id}")
def booth_result(product_id: str, preview: bool = False, db: Session = Depends(get_db)):
    """QR로 들어온 관람객 개인 폰용 결과 페이지 데이터.
    preview=1이면 체험 태블릿 안에서 미리 보는 것이라 QR 조회 수에 넣지 않는다."""
    product, shop = _load_booth_product(db, product_id)
    store = db.query(Store).filter(Store.id == product.store_id).first()
    if not preview:
        db.add(BoothEvent(type="result_view", product_id=product.id))
        db.commit()
    return {
        "success": True,
        "product": _booth_product_dict(product, shop.number),
        "store": {
            "name": store.name if store else product.shop_name,
            "number": shop.number,
            "openedAt": shop.created_at.isoformat() + "Z" if shop.created_at else None,
        },
    }


@router.get("/market")
def booth_market(db: Session = Depends(get_db)):
    """3D 가상 시장용 — 숨기지 않은 부스 가게(최근 144곳)와 가게마다 대표 상품(가장 최근 상품)을 준다.
    3D 화면이 몇 초마다 다시 불러서 새로 문을 연 가게를 시장에 세운다."""
    rows = (
        db.query(BoothShop, Store.name)
        .join(Store, Store.id == BoothShop.store_id)
        .filter(BoothShop.hidden.is_(False))
        .order_by(BoothShop.number.desc())
        .limit(144)
        .all()
    )
    rows.reverse()  # 오래된 가게부터(시장 가운데부터 채워진다)
    store_ids = [shop.store_id for shop, _ in rows]
    by_store: dict[str, list[Product]] = {}
    if store_ids:
        for product in (
            db.query(Product)
            .filter(Product.store_id.in_(store_ids), Product.market_id == BOOTH_MARKET_ID)
            .order_by(Product.created_at.desc())
            .all()
        ):
            by_store.setdefault(product.store_id, []).append(product)

    def market_item(product: Product, number: int) -> dict:
        d = _booth_product_dict(product, number)
        return {
            "id": d["id"],
            "title": d.get("title") or "",
            "unit": d.get("unit") or "",
            "origin": d.get("origin") or "",
            "price": d.get("price") or 0,
            "publicPrice": d.get("publicPrice") or 0,
            "grade": d.get("grade") or "",
            "confidence": d.get("gradeConfidencePercent"),
            "attributeLabels": d.get("attributeLabels") or {},
            "aiSummary": d.get("aiSummary") or "",
            "description": d.get("description") or "",  # 사장님 한마디(홍보 문구)
            "tags": [t for t in (d.get("tags") or "").split(",") if t.strip()][:3],
            # 사진은 크기가 커서 목록에 넣지 않고, 상세를 열 때 /api/v1/booth/result/{id}/image 로 받는다
        }

    shops = []
    for shop, name in rows:
        products = by_store.get(shop.store_id, [])
        # 3D 매대에 진열 상품을 여러 개 보여주고, 가까이 가면 골라 볼 수 있게 최근 6개까지 준다.
        # "product"(대표 상품 1개)는 예전 화면과의 호환을 위해 그대로 둔다.
        items = [market_item(p, shop.number) for p in products[:6]]
        shops.append({
            "storeId": shop.store_id,
            "number": shop.number,
            "name": name,
            "tagline": shop.tagline,
            "productCount": len(products),
            "product": items[0] if items else None,
            "products": items,
        })
    return {"success": True, "shops": shops}


@router.get("/shop/{store_id}")
def booth_shop(store_id: str, preview: bool = False, db: Session = Depends(get_db)):
    """QR로 여는 '내 가게 페이지' — 가게 정보와 진열한 상품 전체(최신순).
    preview=1이면 앱 내 정보 화면에서 부르는 것이라 방문 수에 넣지 않는다."""
    store = db.query(Store).filter(Store.id == store_id, Store.market_id == BOOTH_MARKET_ID).first()
    shop = db.query(BoothShop).filter(BoothShop.store_id == store_id).first() if store else None
    if not store or not shop or shop.hidden:
        raise HTTPException(status_code=404, detail="가게를 찾을 수 없어요.")
    products = (
        db.query(Product)
        .filter(Product.store_id == store_id)
        .order_by(Product.created_at.desc())
        .all()
    )
    if not preview:
        db.add(BoothEvent(type="shop_view", detail=store_id))
        db.commit()
    return {
        "success": True,
        "store": {
            "id": store.id,
            "name": store.name,
            "number": shop.number,
            "openedAt": shop.created_at.isoformat() + "Z" if shop.created_at else None,
            "tagline": shop.tagline,
        },
        "products": [_booth_product_dict(p, shop.number) for p in products],
    }


def _generate_booth_docent(product: Product, shop_number: int) -> str:
    """관람객이 만든 가게를 소개하는 AI 도슨트 해설. OpenAI → Gemini → 고정 문장 순으로 폴백한다."""
    grade_text = "특상" if product.grade == "A+" else "보통"
    labels = json.loads(product.attribute_labels) if product.attribute_labels else {}
    label_text = ", ".join(f"{name} {v.get('grade')}" for name, v in labels.items() if isinstance(v, dict)) or "정보 없음"
    prompt = (
        "당신은 전통시장 오디오 도슨트 해설자입니다. CO-SHOW 2026 전시장(김대중컨벤션센터)의 "
        f"'CO-SHOW 가상 시장'에 관람객이 직접 {shop_number}번째로 문을 연 가게 '{product.shop_name}'을 소개해주세요.\n"
        f"진열 상품: {product.title}\n"
        f"AI 품질 판정: {grade_text} 등급 (세부 속성: {label_text})\n"
        f"AI 종합 의견: {product.ai_summary or '정보 없음'}\n"
        f"판매가: 1kg {product.price:,}원 / 공공 시세(KAMIS) 1kg {product.public_price:,}원\n\n"
        "이 가게 앞에 선 손님에게 들려주듯 3~4문장의 친근한 한국어 구어체로 작성하세요. "
        "주어진 정보 외의 사실(산지, 가게 역사 등)은 지어내지 말고, 따옴표로 감싸지 마세요."
    )
    text = _generate_openai_text(prompt, temperature=1.0)
    if not text:
        client = get_gemini_client()
        if client is not None:
            try:
                response = client.models.generate_content(model="gemini-3.6-flash", contents=[prompt])
                text = (response.text or "").strip() or None
            except Exception as e:
                print(f"Gemini 부스 도슨트 생성 실패 (고정 문장으로 폴백): {e}")
    if text:
        return text.strip().strip('"')
    return (
        f"CO-SHOW 가상 시장 {shop_number}번 가게, {product.shop_name}에 오신 것을 환영합니다. "
        f"오늘 진열된 {product.title}은(는) 사진 한 장으로 AI가 품질을 확인한 상품으로, {grade_text} 등급을 받았어요. "
        f"공공 시세와 가격을 나란히 비교해 보고 믿고 골라보세요."
    )


@router.get("/result/{product_id}/docent")
async def booth_result_docent(product_id: str, db: Session = Depends(get_db)):
    """AI 도슨트는 생성에 몇 초 걸리므로 결과 페이지와 따로 불러온다. 같은 가게는 캐시를 재사용한다."""
    product, shop = _load_booth_product(db, product_id)
    script = await asyncio.to_thread(
        _cached_or_generate,
        f"booth:{product.id}",
        lambda: _generate_booth_docent(product, shop.number),
    )
    return {"success": True, "script": script}


@router.get("/result/{product_id}/image")
async def booth_result_image(product_id: str, db: Session = Depends(get_db)):
    """결과 페이지의 "내 가게 카드 저장"용 사진. 사진이 다른 도메인(GCS)에 있으면 브라우저가
    카드 이미지로 합칠 수 없어서(보안 제한), 같은 서버를 거쳐 내려준다."""
    product, _shop = _load_booth_product(db, product_id)
    url = product.image_url or ""
    match = re.match(r"^data:(image/[\w.+-]+);base64,(.+)$", url, re.DOTALL)
    if match:
        return Response(content=base64.b64decode(match.group(2)), media_type=match.group(1))
    if not url.startswith("https://storage.googleapis.com/"):
        raise HTTPException(status_code=404, detail="사진을 찾을 수 없습니다.")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(url)
        res.raise_for_status()
    except Exception:
        raise HTTPException(status_code=502, detail="사진을 불러오지 못했습니다.")
    return Response(
        content=res.content,
        media_type=res.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ---------- 체험 기록 (전시 후 성과 집계용) ----------

ALLOWED_EVENT_TYPES = {"session_start", "scan_success", "scan_fail", "register_fail"}


class BoothEventRequest(BaseModel):
    type: str
    productId: str | None = None
    detail: str | None = None


@router.post("/events")
def booth_event(payload: BoothEventRequest, db: Session = Depends(get_db)):
    if payload.type not in ALLOWED_EVENT_TYPES:
        raise HTTPException(status_code=400, detail="알 수 없는 이벤트입니다.")
    db.add(BoothEvent(type=payload.type, product_id=payload.productId, detail=(payload.detail or "")[:200]))
    db.commit()
    return {"success": True}


def _require_admin(key: str | None) -> None:
    expected = os.getenv("BOOTH_ADMIN_KEY")
    if not expected:
        raise HTTPException(status_code=403, detail="관리 기능이 꺼져 있습니다. 서버에 BOOTH_ADMIN_KEY를 설정해주세요.")
    if key != expected:
        raise HTTPException(status_code=403, detail="관리 키가 올바르지 않습니다.")


@router.get("/report")
def booth_report(x_booth_key: str | None = Header(None), db: Session = Depends(get_db)):
    """전시 성과 집계(날짜별 체험/등록/QR 조회 수) — 스태프 전용."""
    _require_admin(x_booth_key)
    daily: dict[str, Counter] = {}
    for event_type, created_at in db.query(BoothEvent.type, BoothEvent.created_at).all():
        day = (created_at + KST).strftime("%Y-%m-%d") if created_at else "unknown"
        daily.setdefault(day, Counter())[event_type] += 1
    unique_qr = db.query(func.count(func.distinct(BoothEvent.product_id))).filter(BoothEvent.type == "result_view").scalar()
    return {
        "success": True,
        "daily": {day: dict(counter) for day, counter in sorted(daily.items())},
        "uniqueResultPagesOpened": unique_qr,
        "totalShops": db.query(BoothShop).count(),
        "hiddenShops": db.query(BoothShop).filter(BoothShop.hidden.is_(True)).count(),
    }


@router.get("/dataset")
def booth_dataset(x_booth_key: str | None = Header(None), db: Session = Depends(get_db)):
    """체험 데이터 내보내기 — 스태프 전용. 숨긴 가게(테스트·부적절)는 뺀다.
    가게별 관람객 유형·소속·한마디·상품 수."""
    _require_admin(x_booth_key)
    shops = (
        db.query(BoothShop, Store.name)
        .join(Store, Store.id == BoothShop.store_id)
        .filter(BoothShop.hidden.is_(False))
        .order_by(BoothShop.number)
        .all()
    )
    visible_ids = {shop.store_id for shop, _ in shops}
    product_count = dict(
        db.query(Product.store_id, func.count(Product.id))
        .filter(Product.market_id == BOOTH_MARKET_ID)
        .group_by(Product.store_id)
        .all()
    )
    visitor_counts = Counter(shop.visitor_type or "미입력" for shop, _ in shops)
    return {
        "success": True,
        "summary": {
            "shops": len(shops),
            "visitorTypes": dict(visitor_counts),
            "affiliations": dict(Counter(shop.affiliation for shop, _ in shops if shop.affiliation)),
        },
        "shops": [
            {
                "number": shop.number,
                "storeId": shop.store_id,
                "name": name,
                "visitorType": shop.visitor_type,
                "affiliation": shop.affiliation,
                "tagline": shop.tagline,
                "products": product_count.get(shop.store_id, 0),
                "openedAt": (shop.created_at + KST).isoformat() if shop.created_at else None,
            }
            for shop, name in shops
        ],
    }


@router.delete("/products/{product_id}")
def hide_booth_product(product_id: str, x_booth_key: str | None = Header(None), db: Session = Depends(get_db)):
    """부적절한 이름/사진이 모니터에 올라왔을 때 스태프가 숨긴다(데이터는 남겨두고 노출만 끈다)."""
    _require_admin(x_booth_key)
    product, shop = _load_booth_product(db, product_id)
    shop.hidden = True
    db.commit()
    return {"success": True}
