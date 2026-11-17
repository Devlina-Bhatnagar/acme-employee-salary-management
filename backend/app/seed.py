"""Idempotent, reproducible 10,000-employee synthetic demo seed.

Run: cd backend && python -m app.seed
"""
from __future__ import annotations

import random
from datetime import date

from sqlalchemy import insert, select

from .main import app
from .models import Employee, SalaryRevision
from .schemas import COUNTRY_CURRENCY, DEPARTMENTS

COUNTRIES = list(COUNTRY_CURRENCY)
FIRST = ("Avery", "Jordan", "Riley", "Taylor", "Morgan", "Casey", "Robin", "Harper", "Alex", "Quinn", "Sam", "Rowan", "Jamie", "Cameron", "Reese", "Dakota")
LAST = ("Shah", "Lee", "Mehta", "Schmidt", "Patel", "Brown", "Miller", "Kim", "Singh", "Taylor", "Clark", "Gupta", "Martin", "Chen", "Wilson", "Anderson")
TITLES = {"Engineering": "Software Engineer", "Product": "Product Manager", "Sales": "Account Executive", "Marketing": "Marketing Specialist", "Finance": "Financial Analyst", "People": "HR Specialist", "Operations": "Operations Specialist", "Support": "Customer Support Specialist"}
SALARIES = {"US": (60_000, 220_000), "IN": (800_000, 5_000_000), "GB": (35_000, 130_000), "DE": (40_000, 135_000), "CA": (50_000, 175_000)}


def seed() -> int:
    rng = random.Random(20261117)
    session = app.state.session_maker
    new_count = 0
    with session() as db:
        existing = set(db.scalars(select(Employee.employee_code).where(Employee.employee_code.like("ACME-%"))))
        batch = []
        for index in range(1, 10_001):
            code = f"ACME-{index:05d}"
            country = COUNTRIES[(index - 1) % len(COUNTRIES)]
            department = DEPARTMENTS[(index - 1) % len(DEPARTMENTS)]
            name = f"{FIRST[rng.randrange(len(FIRST))]} {LAST[rng.randrange(len(LAST))]}"
            salary_low, salary_high = SALARIES[country]
            salary_minor = rng.randrange(salary_low // 1000, salary_high // 1000) * 1000 * 100
            if code in existing:
                continue
            batch.append({
                "employee_code": code, "full_name": name,
                "email": f"employee{index:05d}@acme.example.invalid", "country": country,
                "department": department, "job_title": TITLES[department],
                "currency": COUNTRY_CURRENCY[country], "current_salary_minor": salary_minor, "status": "active",
            })
        for offset in range(0, len(batch), 1000):
            piece = batch[offset: offset + 1000]
            db.execute(insert(Employee), piece)
            codes = [row["employee_code"] for row in piece]
            refs = db.execute(select(Employee.id, Employee.current_salary_minor, Employee.currency).where(Employee.employee_code.in_(codes))).all()
            db.execute(insert(SalaryRevision), [{"employee_id": row.id, "old_salary_minor": None, "new_salary_minor": row.current_salary_minor, "currency": row.currency, "effective_on": date(2026, 1, 1), "reason": "Synthetic demo opening salary", "changed_by_user_id": None} for row in refs])
            db.commit()
            new_count += len(piece)
    return new_count


if __name__ == "__main__":
    added = seed()
    print(f"Demo seed complete: {added} employees added (existing employees were retained).")
