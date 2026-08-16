import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import get_db
from models import User, Market

router = APIRouter(prefix="/api/v1/auth", tags=["Auth"])

JWT_SECRET = os.getenv("JWT_SECRET", "dev-insecure-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7

bearer_scheme = HTTPBearer()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 토큰입니다.")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다.")
    return user


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "displayName": user.display_name,
        "shopName": user.shop_name,
        "marketId": user.market_id,
        "phone": user.phone,
        "avatarIcon": user.avatar_icon,
        "avatarColor": user.avatar_color,
        "profileImage": user.profile_image,
    }


class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str = "customer"  # customer | merchant
    displayName: str
    phone: str
    shopName: Optional[str] = None
    marketId: Optional[str] = None  # 상인 가입 시 고른 소속 전통시장(Market.id)


class LoginRequest(BaseModel):
    username: str
    password: str


class ResetPasswordRequest(BaseModel):
    username: str
    displayName: str
    phone: str


class FindUsernameRequest(BaseModel):
    displayName: str
    phone: str


class UpdateProfileRequest(BaseModel):
    displayName: Optional[str] = None
    phone: Optional[str] = None
    currentPassword: Optional[str] = None
    newPassword: Optional[str] = None
    avatarIcon: Optional[str] = None
    avatarColor: Optional[str] = None
    profileImage: Optional[str] = None


@router.post("/register")
def register(request: RegisterRequest, db: Session = Depends(get_db)):
    if request.role not in ("customer", "merchant"):
        raise HTTPException(status_code=400, detail="role은 customer 또는 merchant여야 합니다.")
    if len(request.username.strip()) < 4:
        raise HTTPException(status_code=400, detail="아이디는 4자 이상이어야 합니다.")
    if len(request.password) < 8:
        raise HTTPException(status_code=400, detail="비밀번호는 8자 이상이어야 합니다.")

    existing = db.query(User).filter(User.username == request.username).first()
    if existing:
        raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다.")

    # 소속 전통시장은 이제 가입 때 받지 않는다 — 로그인 후 마이 탭에서 점포 정보를 처음
    # 채우려 할 때 고른다(PUT /api/v1/merchant/market). marketId를 굳이 보내는 옛 클라이언트가
    # 있을 수 있으니 필드 자체는 남겨두되, 보냈을 때만 검증한다.
    if request.role == "merchant" and request.marketId and not db.query(Market).filter(Market.id == request.marketId).first():
        raise HTTPException(status_code=400, detail="존재하지 않는 전통시장입니다.")

    user = User(
        username=request.username,
        password_hash=hash_password(request.password),
        role=request.role,
        display_name=request.displayName,
        phone=request.phone,
        shop_name=request.shopName,
        market_id=request.marketId if request.role == "merchant" else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return {"success": True, "token": token, "user": serialize_user(user)}


@router.post("/login")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == request.username).first()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")

    token = create_access_token(user.id)
    return {"success": True, "token": token, "user": serialize_user(user)}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {"success": True, "user": serialize_user(current_user)}


# 데모용 아이디 찾기: 가입 시 입력한 이름+휴대폰번호가 둘 다 일치하면 아이디를 그대로
# 돌려준다. 문자 인증 등 실제 본인확인은 없으므로 reset-password와 마찬가지로 데모 전용.
@router.post("/find-username")
def find_username(request: FindUsernameRequest, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .filter(User.display_name == request.displayName, User.phone == request.phone)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="일치하는 계정을 찾을 수 없습니다.")

    return {"success": True, "username": user.username}


# 데모용 비밀번호 재설정: SMS/이메일 인증 대신, 가입 시 등록한 이름+휴대폰번호를
# 아이디와 함께 모두 맞춰야만 재설정이 가능하다 (아이디만으로는 불가 — 아이디는 "아이디
# 찾기"로 비교적 쉽게 알아낼 수 있어서, 그것만으로 비밀번호까지 뺏을 수 있으면 사실상
# 본인확인이 없는 것과 같다). 여전히 실서비스 수준의 SMS/이메일 인증은 아니므로 데모 전용.
@router.post("/reset-password")
def reset_password(request: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .filter(
            User.username == request.username,
            User.display_name == request.displayName,
            User.phone == request.phone,
        )
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="입력하신 정보와 일치하는 계정을 찾을 수 없습니다.")

    temp_password = secrets.token_urlsafe(9)
    user.password_hash = hash_password(temp_password)
    db.commit()

    return {"success": True, "tempPassword": temp_password}


@router.put("/me")
def update_profile(
    request: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if request.newPassword is not None:
        if not request.currentPassword or not verify_password(
            request.currentPassword, current_user.password_hash
        ):
            raise HTTPException(status_code=401, detail="현재 비밀번호가 올바르지 않습니다.")
        if len(request.newPassword) < 8:
            raise HTTPException(status_code=400, detail="새 비밀번호는 8자 이상이어야 합니다.")
        current_user.password_hash = hash_password(request.newPassword)

    if request.displayName is not None and request.displayName.strip():
        current_user.display_name = request.displayName.strip()
    if request.phone is not None and request.phone.strip():
        current_user.phone = request.phone.strip()
    if request.avatarIcon is not None:
        current_user.avatar_icon = request.avatarIcon
    if request.avatarColor is not None:
        current_user.avatar_color = request.avatarColor
    if request.profileImage is not None:
        current_user.profile_image = request.profileImage

    db.commit()
    db.refresh(current_user)
    return {"success": True, "user": serialize_user(current_user)}
