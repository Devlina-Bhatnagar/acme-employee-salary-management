"""Live deployment smoke test against *synthetic demo only*.

Usage: BASE_URL=http://127.0.0.1:8000 HR_ADMIN_EMAIL=... HR_ADMIN_PASSWORD=... python scripts/http_smoke.py
Adds one test employee and salary change. Never run on production data.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone

import httpx

BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8000').rstrip('/')
EMAIL = os.environ['HR_ADMIN_EMAIL']
PASSWORD = os.environ['HR_ADMIN_PASSWORD']
client = httpx.Client(base_url=BASE, timeout=30)


def checked(method, path, **kwargs):
    t0 = time.perf_counter()
    response = client.request(method, path, **kwargs)
    elapsed = (time.perf_counter() - t0) * 1000
    print(f'{method:5s} {path:37s} HTTP {response.status_code}  {elapsed:.0f} ms')
    response.raise_for_status()
    return response


if __name__ == '__main__':
    checked('GET', '/')
    checked('GET', '/app.js')
    checked('GET', '/assets/react.production.min.js')
    checked('GET', '/import-template.csv')
    assert checked('GET', '/api/health').json()['status'] == 'ok'
    assert client.get('/api/employees').status_code == 401
    token = checked('POST', '/api/auth/login', json={'email': EMAIL, 'password': PASSWORD}).json()['access_token']
    client.headers['Authorization'] = f'Bearer {token}'
    all_employees = checked('GET', '/api/employees?page_size=20').json()
    print('Employee count:', all_employees['total'])
    assert all_employees['total'] >= 10000
    summary = checked('GET', '/api/reports/summary').json()
    assert sum(item['headcount'] for item in summary['by_currency']) == summary['headcount']
    print('Currencies:', ', '.join(summary['currencies']))
    checked('GET', '/api/employees?search=employee00001')
    checked('GET', '/api/employees/export?country=DE')
    code = 'SMOKE-' + uuid.uuid4().hex[:10].upper()
    employee = checked('POST', '/api/employees', json={'employee_code': code, 'full_name': 'Demo Tester', 'email': code.lower() + '@example.invalid', 'country': 'US', 'department': 'Engineering', 'job_title': 'Demo Engineer', 'annual_salary': '90000.00', 'currency': 'USD'}).json()
    detail = checked('POST', f"/api/employees/{employee['id']}/salary", json={'annual_salary': '98000.00', 'effective_on': datetime.now(timezone.utc).date().isoformat(), 'reason': 'Assessment HTTP smoke test'}).json()
    assert len(detail['salary_history']) == 2
    assert detail['current_salary_minor'] == 9800000
    print('✅ HTTP/UI-asset/API/10k/salary-history smoke checks passed.')
