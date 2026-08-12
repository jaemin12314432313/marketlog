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
from models import User

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
    }


class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str = "customer"  # customer | merchant
    displayName: str
    phone: str
    shopName: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class ResetPasswordRequest(BaseModel):
    username: str


class FindUsernameRequest(BaseModel):
    displayName: str
    phone: str


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

    user = User(
        username=request.username,
        password_hash=hash_password(request.password),
        role=request.role,
        display_name=request.displayName,
        phone=request.phone,
        shop_name=request.shopName,
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


# 데모용 비밀번호 재설정: SMS/이메일 본인확인 수단이 없는 프로젝트라, 아이디만 맞으면
# 누구나 그 계정의 비밀번호를 즉시 새로 발급받을 수 있다 (실서비스라면 반드시 별도
# 인증 수단을 거쳐야 함). 발급된 임시 비밀번호는 응답으로 그대로 돌려준다.
@router.post("/reset-password")
def reset_password(request: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == request.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="해당 아이디로 가입된 계정을 찾을 수 없습니다.")

    temp_password = secrets.token_urlsafe(9)
    user.password_hash = hash_password(temp_password)
    db.commit()

    return {"success": True, "tempPassword": temp_password}
