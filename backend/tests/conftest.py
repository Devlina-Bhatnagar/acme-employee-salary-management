from __future__ import annotations

import os

os.environ.setdefault("JWT_SECRET", "tests-only-long-secret-not-for-any-deployment")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.pop("HR_ADMIN_EMAIL", None)
os.environ.pop("HR_ADMIN_PASSWORD", None)

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import User
from app.security import create_token, password_hash


@pytest.fixture
def app():
    instance = create_app("sqlite://", testing=True)
    with instance.state.session_maker() as db:
        db.add(User(email="hr@example.invalid", display_name="Test HR", password_hash=password_hash("SecurePassword123!")))
        db.commit()
    yield instance
    instance.state.engine.dispose()


@pytest.fixture
def client(app):
    with TestClient(app) as http:
        yield http


@pytest.fixture
def auth_headers(app):
    with app.state.session_maker() as db:
        user = db.query(User).filter_by(email="hr@example.invalid").one()
        return {"Authorization": f"Bearer {create_token(user.id, app.state.jwt_secret)}"}


@pytest.fixture
def sample_employee():
    return {"employee_code": "A-100", "full_name": "Alex Kim", "email": "alex.kim@example.invalid", "country": "US", "department": "Engineering", "job_title": "Software Engineer", "currency": "USD", "annual_salary": "120000.50"}
