from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

COUNTRY_CURRENCY = {"US": "USD", "IN": "INR", "GB": "GBP", "DE": "EUR", "CA": "CAD"}
COUNTRIES = {"US": "United States", "IN": "India", "GB": "United Kingdom", "DE": "Germany", "CA": "Canada"}
DEPARTMENTS = ("Engineering", "Product", "Sales", "Marketing", "Finance", "People", "Operations", "Support")
MAX_SALARY = Decimal("999999999.99")


def to_minor(value: str | float | int | Decimal) -> int:
    try:
        number = Decimal(str(value))
        if not number.is_finite() or number <= 0 or number > MAX_SALARY or number.as_tuple().exponent < -2:
            raise ValueError("Annual salary must be positive, <= 999999999.99, with at most two decimal places")
        return int(number * 100)
    except (InvalidOperation, TypeError) as exc:
        raise ValueError("Invalid annual salary") from exc


def normalize_email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise ValueError("Enter a valid email address")
    return value


class EmployeeCreate(BaseModel):
    employee_code: str = Field(min_length=3, max_length=32)
    full_name: str = Field(min_length=2, max_length=120)
    email: str
    country: str
    department: str = Field(min_length=2, max_length=80)
    job_title: str = Field(min_length=2, max_length=100)
    currency: str
    annual_salary: Decimal

    @field_validator("employee_code")
    @classmethod
    def valid_code(cls, value: str) -> str:
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{2,31}", value):
            raise ValueError("Employee ID may contain letters, numbers, underscores and dashes")
        return value

    @field_validator("full_name", "department", "job_title")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = " ".join(value.strip().split())
        if not value or value[0] in "=+@\t":
            raise ValueError("Invalid text")
        return value

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        return normalize_email(value)

    @field_validator("country", "currency")
    @classmethod
    def upper(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def check_country_salary(self):
        if self.country not in COUNTRY_CURRENCY:
            raise ValueError("Country must be one of US, IN, GB, DE, CA")
        if self.currency != COUNTRY_CURRENCY[self.country]:
            raise ValueError(f"Currency for {self.country} must be {COUNTRY_CURRENCY[self.country]}")
        to_minor(self.annual_salary)
        return self


class EmployeePatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: str | None = None
    department: str | None = Field(default=None, min_length=2, max_length=80)
    job_title: str | None = Field(default=None, min_length=2, max_length=100)
    status: Literal["active", "inactive"] | None = None

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str | None) -> str | None:
        return normalize_email(value) if value is not None else value

    @field_validator("full_name", "department", "job_title")
    @classmethod
    def clean_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.strip().split())
        if not value or value[0] in "=+@\t":
            raise ValueError("Invalid text")
        return value


class SalaryChange(BaseModel):
    annual_salary: Decimal
    effective_on: date
    reason: str = Field(min_length=5, max_length=500)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 5:
            raise ValueError("Provide a clear reason (at least 5 characters)")
        return value

    @model_validator(mode="after")
    def valid(self):
        to_minor(self.annual_salary)
        if self.effective_on > date.today():
            raise ValueError("Future-dated salary changes are not part of v1")
        return self


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_code: str
    full_name: str
    email: str
    country: str
    department: str
    job_title: str
    currency: str
    current_salary_minor: int
    status: str
    created_at: datetime
    updated_at: datetime


class SalaryRevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    old_salary_minor: int | None
    new_salary_minor: int
    currency: str
    effective_on: date
    reason: str
    changed_at: datetime
    changed_by_email: str | None = None


class EmployeeDetail(EmployeeOut):
    salary_history: list[SalaryRevisionOut]


class EmployeePage(BaseModel):
    items: list[EmployeeOut]
    total: int
    page: int
    page_size: int
    pages: int


class ReportGroup(BaseModel):
    country: str
    department: str
    currency: str
    headcount: int
    total_salary_minor: int
    average_salary_minor: int
    min_salary_minor: int
    max_salary_minor: int


class ReportSummary(BaseModel):
    headcount: int
    currencies: list[str]
    groups: list[ReportGroup]
    by_currency: list[ReportGroup]
    salary_bands: list[dict]
