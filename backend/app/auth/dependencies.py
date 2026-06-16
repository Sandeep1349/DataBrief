from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from ..config import get_settings

_bearer = HTTPBearer()


def require_auth(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    s = get_settings()
    try:
        payload = jwt.decode(credentials.credentials, s.jwt_secret, algorithms=["HS256"])
        username: str | None = payload.get("sub")
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return username
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )
