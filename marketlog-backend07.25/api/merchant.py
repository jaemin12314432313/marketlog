from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
import os
import uuid

from db import get_db
from models import Market, Product, Store, User, product_to_dict, resolve_merchant_market_id
from api.auth import get_current_user

router = APIRouter(tags=["Merchant"])
os.makedirs("uploads", exist_ok=True)


def require_merchant(current_user: User) -> str:
    if current_user.role != "merchant":
        raise HTTPException(status_code=403, detail="판매자 계정만 상품을 등록할 수 있습니다.")
    return current_user.shop_name or current_user.display_name


def merchant_market_id(db: Session, current_user: User) -> str:
    """로그인 후 마이 탭에서 고른 소속 전통시장 — 이 값 기준으로 점포/상품이 전부 그
    시장에 묶인다. resolve_merchant_market_id(models.py, auth.py의 login/me와 공유)가
    market_id를 확정할 수 없는 경우(진짜 신규 계정, 아직 점포도 없음)에도 이 함수
    자체는 "yangdong"을 그대로 반환한다 — set_store_location에서 처음 점포를 만들 때
    같은 fallback 시장으로 만들어져야 나중에 다시 조회될 수 있기 때문이다."""
    return resolve_merchant_market_id(db, current_user) or "yangdong"


def market_region(db: Session, market_id: str) -> str:
    market = db.query(Market).filter(Market.id == market_id).first()
    return market.city if market else ""


def resolve_store_id(db: Session, market_id: str, shop_name: str) -> "str | None":
    """상인의 shop_name과 같은 이름의 점포를 같은 시장 안에서 찾아 지도 핀과 연결한다.
    못 찾으면 None — 상품은 그대로 등록되고, 지도에는 안 뜨는 것으로 조용히 넘어간다.
    """
    store = (
        db.query(Store)
        .filter(Store.market_id == market_id, Store.name == shop_name)
        .first()
    )
    return store.id if store else None


def require_store_ready(db: Session, market_id: str, shop_name: str) -> Store:
    """새 상품 등록은 점포 위치 + 연락처/영업시간이 채워져 있어야만 허용한다 — 상품은
    있는데 지도엔 안 뜨고 연락할 방법도 없는 반쪽짜리 점포가 생기는 걸 막기 위함."""
    store = (
        db.query(Store)
        .filter(Store.market_id == market_id, Store.name == shop_name)
        .first()
    )
    if not store:
        raise HTTPException(status_code=400, detail="상품을 등록하려면 먼저 '점포 위치 등록'을 해주세요.")
    if not (store.phone or "").strip() or not (store.hours or "").strip():
        raise HTTPException(status_code=400, detail="상품을 등록하려면 점포 정보에서 전화번호와 영업시간을 입력해주세요.")
    return store


# 수동 상품 등록/수정/삭제 (MerchantView 직접 입력 폼)
class ProductIn(BaseModel):
    title: str
    unit: str = ""  # 예: "1kg", "3개" — 상품명과 분리해서 저장
    origin: str = ""  # 예: "국내산 · 완도" — "완도산 전복"처럼 상품명에 섞어 쓰지 않는다
    tags: str = ""  # 쉼표로 이어붙인 해시태그, 예: "#달콤한,#산지직송"
    category: str = "AI 추천상품"
    price: int = Field(gt=0)
    publicPrice: int = Field(0, ge=0)
    priceTag: str = ""
    grade: str = "A"
    imageUrl: str = ""
    freshnessScore: int = 0
    defectScore: int = 0
    uniformityScore: int = 0
    description: str = ""
    aiSummary: str | None = None
    isScannedProduct: bool = False
    distance: str = ""
    timeAgo: str = "방금 전 등록"


@router.post("/api/v1/merchant/products")
def create_product(
    payload: ProductIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shop_name = require_merchant(current_user)
    market_id = merchant_market_id(db, current_user)
    store = require_store_ready(db, market_id, shop_name)
    market = db.query(Market).filter(Market.id == market_id).first()
    product = Product(
        market_id=market_id,
        store_id=store.id,
        region=market.city if market else "",
        title=payload.title,
        unit=payload.unit,
        origin=payload.origin,
        tags=payload.tags,
        shop_name=shop_name,
        distance=payload.distance or (f"{market.name} 내 점포" if market else ""),
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
        description=payload.description,
        ai_summary=payload.aiSummary,
        is_scanned_product=payload.isScannedProduct,
        is_merchant_uploaded=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return {"success": True, "product": product_to_dict(product)}


@router.put("/api/v1/merchant/products/{product_id}")
def update_product(
    product_id: str,
    payload: ProductIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shop_name = require_merchant(current_user)
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다.")
    if product.shop_name != shop_name:
        raise HTTPException(status_code=403, detail="본인 점포의 상품만 수정할 수 있습니다.")

    product.title = payload.title
    product.unit = payload.unit
    product.origin = payload.origin
    product.tags = payload.tags
    product.distance = payload.distance
    product.time_ago = payload.timeAgo
    product.price = payload.price
    product.public_price = payload.publicPrice
    product.price_tag = payload.priceTag
    product.grade = payload.grade
    product.category = payload.category
    product.image_url = payload.imageUrl
    product.freshness_score = payload.freshnessScore
    product.defect_score = payload.defectScore
    product.uniformity_score = payload.uniformityScore
    product.description = payload.description
    product.ai_summary = payload.aiSummary
    product.is_scanned_product = payload.isScannedProduct
    db.commit()
    db.refresh(product)
    return {"success": True, "product": product_to_dict(product)}


@router.delete("/api/v1/merchant/products/{product_id}")
def delete_product(
    product_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shop_name = require_merchant(current_user)
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다.")
    if product.shop_name != shop_name:
        raise HTTPException(status_code=403, detail="본인 점포의 상품만 삭제할 수 있습니다.")

    db.delete(product)
    db.commit()
    return {"success": True}


# 소속 전통시장 선택 — 가입 절차를 짧게 하려고 회원가입 때는 안 받고, 로그인 후 마이
# 탭에서 점포 정보를 처음 채우려 할 때 한 번만 고르게 한다. 한 번 고르면 그 이후엔
# 바꿀 수 없다(점포/상품이 이미 이 시장 기준으로 등록되기 시작하므로).
class SetMarketRequest(BaseModel):
    marketId: str | None = None
    # 목록에 없는 시장은 직접 입력으로 새로 만든다 — 좌표를 아직 모르니 0,0으로 두고,
    # 이 상인이 처음 점포 위치를 등록하는 순간(set_store_location) 그 좌표로 채운다.
    customName: str | None = None
    customRegion: str | None = None


@router.put("/api/v1/merchant/market")
def set_merchant_market(
    payload: SetMarketRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_merchant(current_user)
    # market_id가 비어 있어도, 시장 선택 기능이 생기기 전에 가입해 이미 점포가 있는
    # 계정이면 resolve_merchant_market_id가 "yangdong"으로 확정해서 market_id에 그대로
    # 기록해준다 — 여기서 다른 시장으로 바꿔버리면 그 점포/상품이 새 시장 기준 조회에
    # 안 걸려서 통째로 사라진 것처럼 보이는 문제가 실제로 있었다.
    if resolve_merchant_market_id(db, current_user):
        raise HTTPException(status_code=400, detail="이미 소속 전통시장이 설정되어 있습니다.")

    if payload.marketId:
        if not db.query(Market).filter(Market.id == payload.marketId).first():
            raise HTTPException(status_code=400, detail="존재하지 않는 전통시장입니다.")
        current_user.market_id = payload.marketId
    elif payload.customName and payload.customName.strip():
        market = Market(
            id=f"custom-{uuid.uuid4().hex[:10]}",
            name=payload.customName.strip(),
            city=(payload.customRegion or "").strip(),
            center_lat=0.0,
            center_lng=0.0,
        )
        db.add(market)
        current_user.market_id = market.id
    else:
        raise HTTPException(status_code=400, detail="소속 전통시장을 선택하거나 이름을 입력해주세요.")

    db.commit()
    return {"success": True, "marketId": current_user.market_id}


# 상인 점포 위치 등록/조회 — 지도의 실제 점포 데이터(공공데이터 463개)와 상인 shop_name이
# 정확히 일치할 때만 상품이 지도에 뜨던 문제를 해결한다. 상인이 지도에서 직접 자기 점포
# 위치에 핀을 찍으면, 그 이름으로 새 Store를 만들거나(없으면) 기존 걸 갱신한다.
class StoreLocationRequest(BaseModel):
    lat: float
    lng: float


@router.get("/api/v1/merchant/store-location")
def get_store_location(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shop_name = require_merchant(current_user)
    market_id = merchant_market_id(db, current_user)
    store = (
        db.query(Store)
        .filter(Store.market_id == market_id, Store.name == shop_name)
        .first()
    )
    if not store:
        return {"success": True, "store": None}
    return {"success": True, "store": {"id": store.id, "lat": store.lat, "lng": store.lng}}


@router.put("/api/v1/merchant/store-location")
def set_store_location(
    payload: StoreLocationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shop_name = require_merchant(current_user)
    market_id = merchant_market_id(db, current_user)
    store = (
        db.query(Store)
        .filter(Store.market_id == market_id, Store.name == shop_name)
        .first()
    )
    if store:
        store.lat = payload.lat
        store.lng = payload.lng
    else:
        market = db.query(Market).filter(Market.id == market_id).first()
        # 직접입력으로 새로 만든 시장은 좌표를 몰라서 0,0으로 시작했다 — 이 상인이 처음
        # 점포 위치를 찍는 순간이 그 시장의 실제 위치를 알 수 있는 첫 기회이므로, 지도
        # 중심 좌표로 그대로 채워준다.
        if market and market.center_lat == 0.0 and market.center_lng == 0.0:
            market.center_lat = payload.lat
            market.center_lng = payload.lng
        store = Store(
            market_id=market_id,
            name=shop_name,
            subtitle="상인 등록 점포",
            lat=payload.lat,
            lng=payload.lng,
            category="merchant",
            icon="storefront",
            badge_color="#0052FF",
            grade="A",
            notice="",
            notice_time="",
            alley=market.name if market else "",
            story_text=f"{shop_name}은(는) 상인이 직접 지도에 등록한 점포입니다.",
        )
        db.add(store)
    db.commit()
    db.refresh(store)

    # 위치 등록 전에 만들어진 이 상인의 기존 상품들은 store_id가 비어있어 지도에
    # 안 떴을 수 있다 — 위치를 등록/수정하는 시점에 전부 이 점포로 다시 연결해준다.
    db.query(Product).filter(Product.shop_name == shop_name).update({"store_id": store.id})
    db.commit()

    return {"success": True, "store": {"id": store.id, "lat": store.lat, "lng": store.lng}}


# 상인 점포 상세정보(주요 품목/전화번호/영업시간/소개글) — 예전엔 MyWallet 화면에서
# 로컬 상태로만 바뀌고 저장 API 자체가 없어서, 저장 성공 토스트가 떠도 새로고침하면
# 다 날아가는 가짜 기능이었다. Store 레코드가 있어야 저장할 수 있으므로(점포 위치
# 등록이 선행되어야 함) 없으면 안내 메시지와 함께 404를 돌려준다.
class StoreProfileRequest(BaseModel):
    name: str | None = None  # 상호명 — 계정 표시 이름과는 별개의 점포 이름
    subtitle: str | None = None  # 주요 품목
    phone: str | None = None
    hours: str | None = None
    storyText: str | None = None  # 점포 소개글


def _store_profile_dict(store: Store) -> dict:
    return {
        "name": store.name,
        "subtitle": store.subtitle,
        "phone": store.phone,
        "hours": store.hours,
        "storyText": store.story_text,
    }


@router.get("/api/v1/merchant/store-profile")
def get_store_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shop_name = require_merchant(current_user)
    store = (
        db.query(Store)
        .filter(Store.market_id == merchant_market_id(db, current_user), Store.name == shop_name)
        .first()
    )
    if not store:
        return {"success": True, "profile": None}
    return {"success": True, "profile": _store_profile_dict(store)}


@router.put("/api/v1/merchant/store-profile")
def update_store_profile(
    payload: StoreProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shop_name = require_merchant(current_user)
    store = (
        db.query(Store)
        .filter(Store.market_id == merchant_market_id(db, current_user), Store.name == shop_name)
        .first()
    )
    if not store:
        raise HTTPException(
            status_code=404,
            detail="먼저 점포 위치를 등록해주세요. (점포 위치 등록 후 상세정보를 저장할 수 있습니다.)",
        )

    # 상호명은 Store.name이자 상인 매칭 키(shop_name)라, 이름이 실제로 바뀌면 User.shop_name과
    # 이 상인의 기존 상품들(Product.shop_name)도 같이 옮겨줘야 상품이 새 이름 밑에서도 계속
    # 지도/내 상품 목록에 붙어 있는다. 공백이면 무시 — 상호명을 빈 값으로 지울 순 없다.
    if payload.name is not None and payload.name.strip() and payload.name.strip() != store.name:
        new_name = payload.name.strip()
        old_name = store.name
        store.name = new_name
        current_user.shop_name = new_name
        db.query(Product).filter(Product.shop_name == old_name).update({"shop_name": new_name})

    if payload.subtitle is not None:
        store.subtitle = payload.subtitle
    if payload.phone is not None:
        store.phone = payload.phone
    if payload.hours is not None:
        store.hours = payload.hours
    if payload.storyText is not None:
        store.story_text = payload.storyText

    db.commit()
    db.refresh(store)
    return {"success": True, "profile": _store_profile_dict(store)}


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
    market_id = merchant_market_id(db, current_user)

    # 나중에 Gemini API 연동할 자리
    product = Product(
        market_id=market_id,
        store_id=resolve_store_id(db, market_id, shop_name),
        region=market_region(db, market_id),
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
ALLOWED_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB


@router.post("/api/v1/merchant/upload")
async def upload_product(
    price: int = Form(18000),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shop_name = require_merchant(current_user)

    # 클라이언트가 보낸 파일명을 경로에 그대로 쓰면 안 된다 (path traversal).
    # 확장자만 원본에서 취하고, 실제 파일명은 서버가 새로 발급한다.
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="지원하지 않는 이미지 형식입니다 (jpg/png/webp만 허용).")

    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="이미지 용량은 10MB를 초과할 수 없습니다.")

    safe_filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join("uploads", safe_filename)
    with open(file_path, "wb") as buffer:
        buffer.write(contents)

    market_id = merchant_market_id(db, current_user)
    product = Product(
        market_id=market_id,
        store_id=resolve_store_id(db, market_id, shop_name),
        region=market_region(db, market_id),
        title="AI 분석 상품",
        shop_name=shop_name,
        distance="300m",
        time_ago="방금 전",
        price=price,
        public_price=int(price * 1.1),
        price_tag="공공 시세 대비 10% 저렴",
        grade="A+",
        category="수산물",
        image_url=f"/uploads/{safe_filename}",
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
