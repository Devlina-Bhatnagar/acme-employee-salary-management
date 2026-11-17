from __future__ import annotations

import csv
import io
from datetime import date

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import Employee, SalaryRevision, User
from .schemas import EmployeeCreate, to_minor
from .services import conflict, filters_for

FIELDS = ["employee_code", "full_name", "email", "country", "department", "job_title", "annual_salary", "currency"]


def escape_excel(value: str) -> str:
    """Make untrusted cell text inert when opened in spreadsheet software."""
    if value and value.lstrip()[0:1] in ("=", "+", "-", "@", "\t", "\r", "\n"):
        return "'" + value
    return value


def export_csv(db: Session, country: str | None, department: str | None, status: str | None, search: str | None) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(FIELDS + ["status"])
    query = filters_for(select(Employee), country=country, department=department, status=status, search=search).order_by(Employee.employee_code)
    for e in db.scalars(query):
        writer.writerow([escape_excel(e.employee_code), escape_excel(e.full_name), escape_excel(e.email), e.country, escape_excel(e.department), escape_excel(e.job_title), f"{e.current_salary_minor / 100:.2f}", e.currency, e.status])
    return "\ufeff" + output.getvalue()


def parse_import(raw: bytes) -> list[EmployeeCreate]:
    if len(raw) > 3_000_000:
        raise HTTPException(413, "CSV must be 3 MB or smaller")
    try:
        decoded = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(422, "CSV must be UTF-8") from exc
    reader = csv.DictReader(io.StringIO(decoded, newline=""))
    if reader.fieldnames is None or [name.strip() for name in reader.fieldnames] != FIELDS:
        raise HTTPException(422, f"CSV columns must be: {', '.join(FIELDS)}")
    results = []
    seen_codes: set[str] = set()
    seen_emails: set[str] = set()
    for line, row in enumerate(reader, start=2):
        if line > 10001:
            raise HTTPException(413, "Import limited to 10,000 employee rows")
        if None in row or any(value is None for value in row.values()):
            raise HTTPException(422, f"Row {line}: invalid CSV field count")
        try:
            payload = EmployeeCreate.model_validate(row)
        except ValidationError as exc:
            first = exc.errors()[0]
            raise HTTPException(422, f"Row {line}: {first['msg']}") from exc
        if payload.employee_code in seen_codes or payload.email in seen_emails:
            raise HTTPException(409, f"Row {line}: duplicate ID or email within CSV")
        seen_codes.add(payload.employee_code)
        seen_emails.add(payload.email)
        results.append(payload)
    if not results:
        raise HTTPException(422, "CSV has no data rows")
    return results


def import_csv(db: Session, raw: bytes, actor: User) -> dict[str, int]:
    items = parse_import(raw)
    codes = [item.employee_code for item in items]
    emails = [item.email for item in items]
    if db.scalar(select(Employee.id).where(Employee.employee_code.in_(codes)).limit(1)) is not None:
        raise HTTPException(409, "CSV contains an employee ID already in the directory; no rows imported")
    if db.scalar(select(Employee.id).where(Employee.email.in_(emails)).limit(1)) is not None:
        raise HTTPException(409, "CSV contains an email already in the directory; no rows imported")
    try:
        for item in items:
            employee = Employee(employee_code=item.employee_code, full_name=item.full_name, email=item.email, country=item.country, department=item.department, job_title=item.job_title, currency=item.currency, current_salary_minor=to_minor(item.annual_salary), status="active")
            db.add(employee)
            db.flush()
            db.add(SalaryRevision(employee_id=employee.id, old_salary_minor=None, new_salary_minor=employee.current_salary_minor, currency=employee.currency, effective_on=date.today(), reason="Initial salary (CSV import)", changed_by_user_id=actor.id))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise conflict(exc) from exc
    return {"imported": len(items)}
