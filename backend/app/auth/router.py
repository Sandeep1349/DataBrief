from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, HTTPException, status
from jose import jwt
from pydantic import BaseModel

from ..config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])

_ph = PasswordHasher()


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest):
    s = get_settings()
    if body.username != s.app_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not s.app_password_hash:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="APP_PASSWORD_HASH not configured — run ./databrief.sh hash",
        )
    try:
        _ph.verify(s.app_password_hash, body.password)
    except (VerifyMismatchError, Exception):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    expiry = datetime.now(timezone.utc) + timedelta(hours=s.jwt_expiry_hours)
    token = jwt.encode({"sub": body.username, "exp": expiry}, s.jwt_secret, algorithm="HS256")
    return TokenResponse(access_token=token)


@router.post("/logout")
def logout():
    # Token is dropped on the client side; no server-side invalidation for v1
    return {"message": "logged out"}
