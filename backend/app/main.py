from __future__ import annotations

import os
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .csv_io import export_csv, import_csv
from .models import Base, Employee, User
from .reporting import report
from .schemas import EmployeeCreate, EmployeeDetail, EmployeeOut, EmployeePage, EmployeePatch, ReportSummary, SalaryChange
from .security import create_token, current_user, get_db, password_hash, verify_password
from .services import change_salary, create_employee, edit_employee, employee_detail, filters_for, get_employee_or_404


class LoginBody(BaseModel):
    email: str
    password: str


def create_app(db_url: str | None = None, *, testing: bool = False) -> FastAPI:
    url = db_url or os.environ.get("DATABASE_URL", "sqlite:///./acme.db")
    secret = os.environ.get("JWT_SECRET", "")
    if not testing and len(secret) < 32:
        raise RuntimeError("JWT_SECRET must be set to a secret of at least 32 characters")
    if testing and not secret:
        secret = "testing-only-secret-do-not-use-production"

    connect_args = {"check_same_thread": False, "timeout": 20} if url.startswith("sqlite") else {}
    is_memory = url in ("sqlite://", "sqlite:///:memory:")
    engine = create_engine(url, connect_args=connect_args, poolclass=StaticPool if is_memory else None)
    if url.startswith("sqlite"):
        from sqlalchemy import event

        @event.listens_for(engine, "connect")
        def sqlite_pragmas(dbapi_conn, _):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=20000")
            cursor.close()
    Base.metadata.create_all(engine)
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    app = FastAPI(title="ACME Salary Manager", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.session_maker = session_maker
    app.state.jwt_secret = secret
    app.state.engine = engine

    @app.middleware("http")
    async def add_security_headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    admin_email = os.environ.get("HR_ADMIN_EMAIL", "").strip().lower()
    admin_password = os.environ.get("HR_ADMIN_PASSWORD", "")
    if (admin_email or admin_password) and (not admin_email or len(admin_password) < 12):
        raise RuntimeError("Set HR_ADMIN_EMAIL and HR_ADMIN_PASSWORD (at least 12 characters) together")
    if admin_email and admin_password:
        with session_maker() as db:
            if not db.scalar(select(User.id).where(User.email == admin_email)):
                db.add(User(email=admin_email, password_hash=password_hash(admin_password), display_name="HR Administrator"))
                db.commit()

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.post("/api/auth/login")
    def login(payload: LoginBody, db: Session = Depends(get_db)):
        user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
        # Verify dummy digest too to reduce timing disparity between known/unknown users.
        if not user:
            verify_password(payload.password, _DUMMY_HASH)
        if not user or not verify_password(payload.password, user.password_hash):
            raise HTTPException(401, "Invalid email or password")
        return {"access_token": create_token(user.id, app.state.jwt_secret), "token_type": "bearer", "user": {"email": user.email, "display_name": user.display_name}}

    @app.get("/api/auth/me")
    def me(user: User = Depends(current_user)):
        return {"email": user.email, "display_name": user.display_name}

    @app.get("/api/meta")
    def meta(user: User = Depends(current_user)):
        from .schemas import COUNTRIES, COUNTRY_CURRENCY, DEPARTMENTS
        return {"countries": COUNTRIES, "currencies": COUNTRY_CURRENCY, "departments": DEPARTMENTS}

    @app.get("/api/employees", response_model=EmployeePage)
    def list_employees(
        page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
        search: str | None = Query(None, max_length=120),
        country: str | None = None,
        department: str | None = None,
        status: str | None = Query("active", pattern="^(active|inactive|all)$"),
        sort: str = Query("name", pattern="^(name|salary_asc|salary_desc|updated)$"),
        db: Session = Depends(get_db), user: User = Depends(current_user),
    ):
        status_value = None if status == "all" else status
        filtered = filters_for(select(Employee), country=country, department=department, status=status_value, search=search)
        total = db.scalar(select(func.count()).select_from(filtered.order_by(None).subquery())) or 0
        ordering = {"name": (Employee.full_name.asc(), Employee.id.asc()), "salary_asc": (Employee.current_salary_minor.asc(), Employee.id.asc()), "salary_desc": (Employee.current_salary_minor.desc(), Employee.id.asc()), "updated": (Employee.updated_at.desc(), Employee.id.desc())}
        rows = db.scalars(filtered.order_by(*ordering[sort]).offset((page - 1) * page_size).limit(page_size)).all()
        return {"items": rows, "total": total, "page": page, "page_size": page_size, "pages": (total + page_size - 1) // page_size}

    @app.post("/api/employees", response_model=EmployeeOut, status_code=201)
    def add_employee(payload: EmployeeCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
        return create_employee(db, payload, user)

    @app.get("/api/employees/export")
    def download_employees(
        search: str | None = None, country: str | None = None, department: str | None = None,
        status: str | None = Query("active", pattern="^(active|inactive|all)$"),
        db: Session = Depends(get_db), user: User = Depends(current_user),
    ):
        content = export_csv(db, country, department, None if status == "all" else status, search)
        return Response(content=content, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=acme-employees.csv", "Cache-Control": "no-store"})

    @app.post("/api/employees/import")
    async def upload_employees(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
        if not file.filename or not file.filename.lower().endswith(".csv"):
            raise HTTPException(422, "Upload a .csv file")
        # Avoid reading arbitrarily large uploads in memory.
        raw = await file.read(3_000_001)
        return import_csv(db, raw, user)

    @app.get("/api/employees/{employee_id}", response_model=EmployeeDetail)
    def get_employee(employee_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
        return employee_detail(db, get_employee_or_404(db, employee_id))

    @app.patch("/api/employees/{employee_id}", response_model=EmployeeOut)
    def patch_employee(employee_id: int, patch: EmployeePatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
        return edit_employee(db, get_employee_or_404(db, employee_id), patch, user)

    @app.post("/api/employees/{employee_id}/salary", response_model=EmployeeDetail)
    def salary(employee_id: int, payload: SalaryChange, db: Session = Depends(get_db), user: User = Depends(current_user)):
        employee = change_salary(db, get_employee_or_404(db, employee_id), payload, user)
        return employee_detail(db, employee)

    @app.get("/api/reports/summary", response_model=ReportSummary)
    def summary(country: str | None = None, department: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
        return report(db, country, department)

    web_path = Path(__file__).resolve().parents[2] / "web"
    if web_path.exists():
        app.mount("/assets", StaticFiles(directory=web_path / "vendor"), name="assets")
        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
        def frontend():
            return (web_path / "index.html").read_text()
        @app.get("/import-template.csv", include_in_schema=False)
        def import_template():
            return Response(content=(web_path.parent / "docs" / "import-template.csv").read_bytes(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=acme-import-template.csv"})
        @app.get("/app.js", include_in_schema=False)
        def app_js():
            return Response(content=(web_path / "app.js").read_bytes(), media_type="application/javascript")
        @app.get("/styles.css", include_in_schema=False)
        def app_css():
            return Response(content=(web_path / "styles.css").read_bytes(), media_type="text/css")
    return app


# A constant valid digest for timing-parity checks on nonexistent user accounts.
_DUMMY_HASH = "pbkdf2_sha256$310000$MTIzNDU2Nzg5MGFiY2RlZg==$M/iv3MzoTQpP1aZWwzuGLJZMU/KnZ3aFdnUQ/129L68="
app = create_app()
