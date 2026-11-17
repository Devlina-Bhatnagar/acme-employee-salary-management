"""Small dependency-light password/JWT implementation.

Never log the supplied password or the JWT signing secret.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import User

_bearer = HTTPBearer(auto_error=False)
_ITERATIONS = 310_000


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, count, raw_salt, raw_digest = encoded.split("$")
        if scheme != "pbkdf2_sha256" or not 100_000 <= int(count) <= 2_000_000:
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), base64.b64decode(raw_salt), int(count))
        return hmac.compare_digest(digest, base64.b64decode(raw_digest))
    except (ValueError, TypeError):
        return False


def create_token(user_id: int, secret: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user_id), "iat": now, "exp": now + timedelta(hours=4)}, secret, algorithm="HS256")


def get_db(request: Request):
    db = request.app.state.session_maker()
    try:
        yield db
    finally:
        db.close()


def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required", headers={"WWW-Authenticate": "Bearer"})
    if not credentials:
        raise error
    try:
        claims = jwt.decode(credentials.credentials, request.app.state.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
        user_id = int(claims["sub"])
    except (jwt.PyJWTError, TypeError, ValueError):
        raise error from None
    user = db.get(User, user_id)
    if not user:
        raise error
    return user
