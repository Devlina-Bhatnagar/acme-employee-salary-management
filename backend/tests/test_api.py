from __future__ import annotations

import io
from datetime import date, timedelta

from app.models import AuditEvent, Employee, SalaryRevision
from app.schemas import to_minor


def create(client, headers, payload):
    response = client.post("/api/employees", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_unauthorized_and_health(client, sample_employee):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/employees").status_code == 401
    assert client.get("/api/reports/summary").status_code == 401
    assert client.post("/api/employees", json=sample_employee).status_code == 401
    assert client.get("/api/employees/export").status_code == 401


def test_login_and_token_expiry_handling(client):
    assert client.post("/api/auth/login", json={"email": "hr@example.invalid", "password": "wrong"}).status_code == 401
    res = client.post("/api/auth/login", json={"email": "HR@EXAMPLE.INVALID", "password": "SecurePassword123!"})
    assert res.status_code == 200
    token = res.json()["access_token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["email"] == "hr@example.invalid"
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer invalid"}).status_code == 401


def test_create_search_filter_pagination_and_sort(client, auth_headers, sample_employee):
    first = create(client, auth_headers, sample_employee)
    second = create(client, auth_headers, {**sample_employee, "employee_code": "B-200", "full_name": "Zoe Lee", "email": "zoe@example.invalid", "country": "DE", "currency": "EUR", "department": "Sales", "annual_salary": "90000"})
    assert first["current_salary_minor"] == 12000050
    assert second["current_salary_minor"] == 9000000
    assert client.get("/api/employees?country=US", headers=auth_headers).json()["total"] == 1
    assert client.get("/api/employees?department=Sales", headers=auth_headers).json()["total"] == 1
    assert client.get("/api/employees?search=kim", headers=auth_headers).json()["items"][0]["id"] == first["id"]
    page = client.get("/api/employees?page=2&page_size=1&sort=name", headers=auth_headers).json()
    assert page["total"] == 2 and page["pages"] == 2
    assert page["items"][0]["full_name"] == "Zoe Lee"
    assert client.get("/api/employees?sort=salary_asc", headers=auth_headers).status_code == 422
    sorted_rows = client.get("/api/employees?country=US&sort=salary_asc", headers=auth_headers).json()["items"]
    assert [item["employee_code"] for item in sorted_rows] == ["A-100"]
    assert client.get("/api/employees?page_size=1000", headers=auth_headers).status_code == 422


def test_duplicate_id_or_email_is_conflict(client, auth_headers, sample_employee):
    create(client, auth_headers, sample_employee)
    assert client.post("/api/employees", json={**sample_employee, "email": "different@example.invalid"}, headers=auth_headers).status_code == 409
    assert client.post("/api/employees", json={**sample_employee, "employee_code": "OTHER-1"}, headers=auth_headers).status_code == 409
    assert client.get("/api/employees", headers=auth_headers).json()["total"] == 1


def test_salary_change_creates_author_attributed_append_only_history(client, auth_headers, sample_employee):
    employee = create(client, auth_headers, sample_employee)
    payload = {"annual_salary": "135000.25", "effective_on": date.today().isoformat(), "reason": "Annual performance review"}
    updated = client.post(f"/api/employees/{employee['id']}/salary", headers=auth_headers, json=payload)
    assert updated.status_code == 200, updated.text
    detail = updated.json()
    assert detail["current_salary_minor"] == 13500025
    history = detail["salary_history"]
    assert len(history) == 2
    assert history[0]["old_salary_minor"] == 12000050
    assert history[0]["new_salary_minor"] == 13500025
    assert history[0]["changed_by_email"] == "hr@example.invalid"
    assert history[1]["reason"] == "Initial salary"
    assert len(client.get(f"/api/employees/{employee['id']}", headers=auth_headers).json()["salary_history"]) == 2


def test_invalid_salaries_dates_and_inactive_employee(client, auth_headers, sample_employee):
    employee = create(client, auth_headers, sample_employee)
    url = f"/api/employees/{employee['id']}/salary"
    base = {"annual_salary": "130000", "effective_on": date.today().isoformat(), "reason": "Market adjustment"}
    assert client.post(url, json={**base, "annual_salary": "130000.001"}, headers=auth_headers).status_code == 422
    assert client.post(url, json={**base, "annual_salary": "-1"}, headers=auth_headers).status_code == 422
    assert client.post(url, json={**base, "effective_on": (date.today() + timedelta(days=1)).isoformat()}, headers=auth_headers).status_code == 422
    assert client.post(url, json={**base, "annual_salary": "120000.50"}, headers=auth_headers).status_code == 409
    assert client.post(url, json=base, headers=auth_headers).status_code == 200
    assert client.post(url, json={**base, "annual_salary": "140000", "effective_on": "2020-01-01"}, headers=auth_headers).status_code == 409
    assert client.patch(f"/api/employees/{employee['id']}", json={"status": "inactive"}, headers=auth_headers).status_code == 200
    assert client.post(url, json={**base, "annual_salary": "150000"}, headers=auth_headers).status_code == 409
    assert client.get("/api/employees", headers=auth_headers).json()["total"] == 0
    assert client.get("/api/employees?status=inactive", headers=auth_headers).json()["total"] == 1


def test_profile_edit_audited_and_country_immutable(client, auth_headers, sample_employee, app):
    employee = create(client, auth_headers, sample_employee)
    response = client.patch(f"/api/employees/{employee['id']}", headers=auth_headers, json={"department": "Product", "job_title": "Senior PM"})
    assert response.status_code == 200
    assert response.json()["department"] == "Product"
    # The API rejects country/currency patching rather than silently ignoring it.
    assert client.patch(f"/api/employees/{employee['id']}", headers=auth_headers, json={"country": "DE"}).status_code == 422
    assert client.patch(f"/api/employees/{employee['id']}", headers=auth_headers, json={"email": "alex2@example.invalid"}).status_code == 200
    with app.state.session_maker() as db:
        actions = list(db.query(AuditEvent).filter_by(employee_id=employee["id"]).order_by(AuditEvent.id))
        assert [entry.action for entry in actions] == ["employee_created", "employee_updated", "employee_updated"]


def test_reporting_never_combines_currencies_and_respects_filter(client, auth_headers, sample_employee):
    create(client, auth_headers, sample_employee)
    create(client, auth_headers, {**sample_employee, "employee_code": "A-101", "full_name": "Riley Lee", "email": "riley@example.invalid", "annual_salary": "80000.50"})
    create(client, auth_headers, {**sample_employee, "employee_code": "B-222", "full_name": "Ravi Shah", "email": "ravi@example.invalid", "country": "IN", "currency": "INR", "annual_salary": "2400000", "department": "Sales"})
    summary = client.get("/api/reports/summary", headers=auth_headers).json()
    assert summary["headcount"] == 3
    assert summary["currencies"] == ["INR", "USD"]
    assert len(summary["by_currency"]) == 2
    usd = next(item for item in summary["by_currency"] if item["currency"] == "USD")
    assert usd["total_salary_minor"] == 20000100
    assert usd["average_salary_minor"] == 10000050
    assert sum(item["headcount"] for item in summary["salary_bands"] if item["currency"] == "USD") == 2
    filt = client.get("/api/reports/summary?country=IN", headers=auth_headers).json()
    assert filt["headcount"] == 1 and filt["currencies"] == ["INR"]


def test_csv_import_atomic_and_export_filtered(client, auth_headers, sample_employee):
    csv1 = b"employee_code,full_name,email,country,department,job_title,annual_salary,currency\nX-001,Test One,one@example.invalid,US,Engineering,Developer,80000,USD\nX-002,Test Two,two@example.invalid,DE,Finance,Analyst,60000,EUR\n"
    response = client.post("/api/employees/import", headers=auth_headers, files={"file": ("employees.csv", csv1, "text/csv")})
    assert response.status_code == 200, response.text
    assert response.json()["imported"] == 2
    data = client.get("/api/employees/export?country=DE", headers=auth_headers)
    assert data.status_code == 200
    assert "X-002" in data.text and "X-001" not in data.text
    bad = csv1.replace(b"X-002", b"X-001")
    err = client.post("/api/employees/import", headers=auth_headers, files={"file": ("bad.csv", bad, "text/csv")})
    assert err.status_code == 409
    assert client.get("/api/employees", headers=auth_headers).json()["total"] == 2
    # New row before an already-existing ID must not be persisted.
    bad2 = csv1.replace(b"X-001,Test One,one@example.invalid", b"X-003,Test Three,three@example.invalid")
    assert client.post("/api/employees/import", headers=auth_headers, files={"file": ("bad2.csv", bad2, "text/csv")}).status_code == 409
    assert client.get("/api/employees", headers=auth_headers).json()["total"] == 2


def test_invalid_employee_validation(client, auth_headers, sample_employee):
    examples = [
        {"country": "ZZ"}, {"country": "DE", "currency": "USD"},
        {"annual_salary": "0"}, {"annual_salary": "7000.001"},
        {"email": "not-email"}, {"employee_code": "BAD ID"},
    ]
    for values in examples:
        resp = client.post("/api/employees", json={**sample_employee, **values}, headers=auth_headers)
        assert resp.status_code == 422, (values, resp.text)


def test_import_checks_csv_structure(client, auth_headers):
    invalid = [b"a,b\n1,2\n", b"employee_code,full_name,email,country,department,job_title,annual_salary,currency\n", b"\xff\xfe"]
    for raw in invalid:
        resp = client.post("/api/employees/import", headers=auth_headers, files={"file": ("employees.csv", raw, "text/csv")})
        assert resp.status_code == 422
    assert client.get("/api/employees", headers=auth_headers).json()["total"] == 0


def test_metadata_authenticated(client, auth_headers):
    assert client.get("/api/meta").status_code == 401
    assert client.get("/api/meta", headers=auth_headers).json()["currencies"]["DE"] == "EUR"


def test_money_precision():
    assert to_minor("0.01") == 1
    assert to_minor("999999999.99") == 99999999999


def test_literal_search_special_chars(client, auth_headers, sample_employee):
    create(client, auth_headers, sample_employee)
    assert client.get('/api/employees?search=%25', headers=auth_headers).json()['total'] == 0
    assert client.get('/api/employees?search=_', headers=auth_headers).json()['total'] == 0


def test_export_escapes_spreadsheet_formula_prefix(client, auth_headers, sample_employee):
    create(client, auth_headers, {**sample_employee, 'full_name': '-SUM(1,1)'})
    text = client.get('/api/employees/export', headers=auth_headers).text
    assert "'-SUM(1,1)" in text
