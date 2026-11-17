from __future__ import annotations

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .models import Employee
from .schemas import ReportSummary
from .services import filters_for


def report(db: Session, country: str | None = None, department: str | None = None) -> ReportSummary:
    # Reporting deliberately excludes inactive employees by default.
    def base(query):
        return filters_for(query, country=country, department=department, status="active")

    count = db.scalar(base(select(func.count()).select_from(Employee))) or 0
    group_cols = (Employee.country, Employee.department, Employee.currency)
    statement = base(select(
        *group_cols,
        func.count().label("headcount"),
        func.sum(Employee.current_salary_minor).label("total"),
        func.min(Employee.current_salary_minor).label("minimum"),
        func.max(Employee.current_salary_minor).label("maximum"),
    )).group_by(*group_cols).order_by(*group_cols)
    groups = [{
        "country": row.country,
        "department": row.department,
        "currency": row.currency,
        "headcount": row.headcount,
        "total_salary_minor": row.total,
        "average_salary_minor": row.total // row.headcount,
        "min_salary_minor": row.minimum,
        "max_salary_minor": row.maximum,
    } for row in db.execute(statement)]

    currency_rows = db.execute(base(select(Employee.currency, func.count().label("headcount"), func.sum(Employee.current_salary_minor).label("total"), func.min(Employee.current_salary_minor).label("minimum"), func.max(Employee.current_salary_minor).label("maximum"))).group_by(Employee.currency).order_by(Employee.currency)).all()
    by_currency = [{"country": "All", "department": "All", "currency": row.currency, "headcount": row.headcount, "total_salary_minor": row.total, "average_salary_minor": row.total // row.headcount, "min_salary_minor": row.minimum, "max_salary_minor": row.maximum} for row in currency_rows]

    # Bands are within each currency; monetary cutoffs are specified in local units.
    bands = [("<50k", 0, 5_000_000), ("50k–100k", 5_000_000, 10_000_000), ("100k–200k", 10_000_000, 20_000_000), ("200k+", 20_000_000, None)]
    salary_bands = []
    for currency in [row.currency for row in currency_rows]:
        for label, low, high in bands:
            statement = base(select(func.count()).select_from(Employee)).where(Employee.currency == currency, Employee.current_salary_minor >= low)
            if high is not None:
                statement = statement.where(Employee.current_salary_minor < high)
            salary_bands.append({"currency": currency, "band": label, "headcount": db.scalar(statement) or 0})
    return ReportSummary(headcount=count, currencies=sorted(row.currency for row in currency_rows), groups=groups, by_currency=by_currency, salary_bands=salary_bands)
