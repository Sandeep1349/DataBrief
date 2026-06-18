from datetime import datetime, timedelta, timezone
import secrets
import uuid

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, HTTPException, status
from jose import jwt
from pydantic import BaseModel

from ..config import get_settings
from ..database import get_client

router = APIRouter(prefix="/auth", tags=["auth"])
_ph = PasswordHasher()


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


def _ensure_tables(client) -> None:
    client.command("""
        CREATE TABLE IF NOT EXISTS databrief.users (
            user_id       String,
            username      String,
            email         String,
            password_hash String,
            is_active     UInt8,
            created_at    DateTime64(3, 'UTC'),
            updated_at    DateTime64(3, 'UTC')
        ) ENGINE = ReplacingMergeTree(updated_at)
        ORDER BY user_id
    """)
    client.command("""
        CREATE TABLE IF NOT EXISTS databrief.password_reset_tokens (
            token_id   String,
            user_id    String,
            token      String,
            expires_at DateTime64(3, 'UTC'),
            created_at DateTime64(3, 'UTC')
        ) ENGINE = MergeTree
        ORDER BY (user_id, created_at)
    """)
    client.command("""
        CREATE TABLE IF NOT EXISTS databrief.used_reset_tokens (
            token   String,
            used_at DateTime64(3, 'UTC')
        ) ENGINE = MergeTree
        ORDER BY token
    """)


def _seed_admin_if_empty(client) -> None:
    s = get_settings()
    count = client.query("SELECT count() FROM databrief.users FINAL").result_rows[0][0]
    if count == 0 and s.app_password_hash:
        now = datetime.now(timezone.utc)
        client.insert(
            "databrief.users",
            [[str(uuid.uuid4()), s.app_user, f"{s.app_user}@localhost", s.app_password_hash, 1, now, now]],
            column_names=["user_id", "username", "email", "password_hash", "is_active", "created_at", "updated_at"],
        )


def _get_user_by_username(client, username: str) -> dict | None:
    rows = list(client.query(
        "SELECT user_id, username, email, password_hash, is_active FROM databrief.users FINAL WHERE username = {username:String}",
        parameters={"username": username},
    ).named_results())
    return rows[0] if rows else None


def _get_user_by_email(client, email: str) -> dict | None:
    rows = list(client.query(
        "SELECT user_id, username, email, password_hash, is_active FROM databrief.users FINAL WHERE email = {email:String}",
        parameters={"email": email},
    ).named_results())
    return rows[0] if rows else None


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest):
    s = get_settings()
    client = get_client()
    _ensure_tables(client)
    _seed_admin_if_empty(client)

    user = _get_user_by_username(client, body.username)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user["is_active"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    try:
        _ph.verify(user["password_hash"], body.password)
    except (VerifyMismatchError, Exception):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    expiry = datetime.now(timezone.utc) + timedelta(hours=s.jwt_expiry_hours)
    token = jwt.encode({"sub": body.username, "exp": expiry}, s.jwt_secret, algorithm="HS256")
    return TokenResponse(access_token=token)


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest):
    client = get_client()
    _ensure_tables(client)
    _seed_admin_if_empty(client)

    if _get_user_by_username(client, body.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    if _get_user_by_email(client, body.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    if len(body.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters",
        )

    now = datetime.now(timezone.utc)
    client.insert(
        "databrief.users",
        [[str(uuid.uuid4()), body.username, body.email, _ph.hash(body.password), 1, now, now]],
        column_names=["user_id", "username", "email", "password_hash", "is_active", "created_at", "updated_at"],
    )
    return {"message": "Account created successfully"}


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordRequest):
    client = get_client()
    _ensure_tables(client)

    user = _get_user_by_email(client, body.email)
    if not user:
        # Don't reveal whether the email is registered
        return {"message": "If that email is registered, a reset token has been generated.", "reset_token": None}

    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    client.insert(
        "databrief.password_reset_tokens",
        [[str(uuid.uuid4()), user["user_id"], token, now + timedelta(hours=1), now]],
        column_names=["token_id", "user_id", "token", "expires_at", "created_at"],
    )
    return {
        "message": "Reset token generated. Copy it and use it within 1 hour.",
        "reset_token": token,
    }


@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest):
    client = get_client()
    _ensure_tables(client)

    now = datetime.now(timezone.utc)

    token_rows = list(client.query(
        """SELECT prt.token_id, prt.user_id, prt.expires_at
           FROM databrief.password_reset_tokens AS prt
           LEFT ANTI JOIN databrief.used_reset_tokens AS urt ON prt.token = urt.token
           WHERE prt.token = {token:String}
           ORDER BY prt.created_at DESC
           LIMIT 1""",
        parameters={"token": body.token},
    ).named_results())

    if not token_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or already used reset token"
        )

    row = token_rows[0]
    expires_at = row["expires_at"]
    if hasattr(expires_at, "tzinfo") and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if now > expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset token has expired")

    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters",
        )

    client.insert(
        "databrief.used_reset_tokens",
        [[body.token, now]],
        column_names=["token", "used_at"],
    )

    user_rows = list(client.query(
        "SELECT user_id, username, email, is_active, created_at FROM databrief.users FINAL WHERE user_id = {uid:String}",
        parameters={"uid": row["user_id"]},
    ).named_results())

    if not user_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    u = user_rows[0]
    client.insert(
        "databrief.users",
        [[u["user_id"], u["username"], u["email"], _ph.hash(body.new_password), u["is_active"], u["created_at"], datetime.now(timezone.utc)]],
        column_names=["user_id", "username", "email", "password_hash", "is_active", "created_at", "updated_at"],
    )

    return {"message": "Password reset successfully. You can now log in with your new password."}


@router.post("/logout")
def logout():
    return {"message": "logged out"}
