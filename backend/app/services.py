from __future__ import annotations

import json
from datetime import date

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import AuditEvent, Employee, SalaryRevision, User
from .schemas import EmployeeCreate, EmployeePatch, SalaryChange, to_minor


def conflict(exc: IntegrityError) -> HTTPException:
    message = str(exc.orig).lower()
    if "employee_code" in message:
        return HTTPException(status_code=409, detail="Employee ID already exists")
    if "email" in message:
        return HTTPException(status_code=409, detail="Email already exists")
    return HTTPException(status_code=409, detail="Record conflicts with an existing employee")


def get_employee_or_404(db: Session, employee_id: int) -> Employee:
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return employee


def filters_for(query, *, country: str | None, department: str | None, status: str | None, search: str | None = None):
    if country:
        query = query.where(Employee.country == country.upper())
    if department:
        query = query.where(Employee.department == department)
    if status:
        query = query.where(Employee.status == status)
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.where(or_(func.lower(Employee.employee_code).like(term), func.lower(Employee.full_name).like(term), func.lower(Employee.email).like(term)))
    return query


def create_employee(db: Session, payload: EmployeeCreate, actor: User | None, *, reason: str = "Initial salary") -> Employee:
    employee = Employee(
        employee_code=payload.employee_code,
        full_name=payload.full_name,
        email=payload.email,
        country=payload.country,
        department=payload.department,
        job_title=payload.job_title,
        currency=payload.currency,
        current_salary_minor=to_minor(payload.annual_salary),
        status="active",
    )
    try:
        db.add(employee)
        db.flush()
        db.add(SalaryRevision(
            employee_id=employee.id,
            old_salary_minor=None,
            new_salary_minor=employee.current_salary_minor,
            currency=employee.currency,
            effective_on=date.today(),
            reason=reason,
            changed_by_user_id=actor.id if actor else None,
        ))
        db.add(AuditEvent(employee_id=employee.id, actor_user_id=actor.id if actor else None, action="employee_created", details_json=json.dumps({"employee_code": employee.employee_code})))
        db.commit()
        db.refresh(employee)
        return employee
    except IntegrityError as exc:
        db.rollback()
        raise conflict(exc) from exc


def edit_employee(db: Session, employee: Employee, patch: EmployeePatch, actor: User) -> Employee:
    values = patch.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(status_code=400, detail="No fields to update")
    if any(value is None for value in values.values()):
        raise HTTPException(status_code=422, detail="Fields cannot be null")
    changes = {}
    for field, new_value in values.items():
        old_value = getattr(employee, field)
        if old_value != new_value:
            setattr(employee, field, new_value)
            changes[field] = {"from": old_value, "to": new_value}
    if not changes:
        return employee
    db.add(AuditEvent(employee_id=employee.id, actor_user_id=actor.id, action="employee_updated", details_json=json.dumps(changes)))
    try:
        db.commit()
        db.refresh(employee)
        return employee
    except IntegrityError as exc:
        db.rollback()
        raise conflict(exc) from exc


def change_salary(db: Session, employee: Employee, payload: SalaryChange, actor: User) -> Employee:
    if employee.status != "active":
        raise HTTPException(status_code=409, detail="Salary cannot change for an inactive employee")
    minor = to_minor(payload.annual_salary)
    if minor == employee.current_salary_minor:
        raise HTTPException(status_code=409, detail="Salary has not changed")
    latest_date = db.scalar(select(func.max(SalaryRevision.effective_on)).where(SalaryRevision.employee_id == employee.id))
    if latest_date and payload.effective_on < latest_date:
        raise HTTPException(status_code=409, detail=f"Effective date must be on or after {latest_date.isoformat()}")
    db.add(SalaryRevision(employee_id=employee.id, old_salary_minor=employee.current_salary_minor, new_salary_minor=minor, currency=employee.currency, effective_on=payload.effective_on, reason=payload.reason, changed_by_user_id=actor.id))
    employee.current_salary_minor = minor
    db.commit()
    db.refresh(employee)
    return employee


def employee_detail(db: Session, employee: Employee) -> dict:
    history = db.execute(select(SalaryRevision, User.email).outerjoin(User, SalaryRevision.changed_by_user_id == User.id).where(SalaryRevision.employee_id == employee.id).order_by(SalaryRevision.effective_on.desc(), SalaryRevision.id.desc())).all()
    return {
        **{name: getattr(employee, name) for name in ("id", "employee_code", "full_name", "email", "country", "department", "job_title", "currency", "current_salary_minor", "status", "created_at", "updated_at")},
        "salary_history": [{"id": revision.id, "old_salary_minor": revision.old_salary_minor, "new_salary_minor": revision.new_salary_minor, "currency": revision.currency, "effective_on": revision.effective_on, "reason": revision.reason, "changed_at": revision.changed_at, "changed_by_email": email} for revision, email in history],
    }
