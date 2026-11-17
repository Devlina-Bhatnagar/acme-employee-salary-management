"""Deterministic 10,000-employee integration fixture (no external resources)."""
from __future__ import annotations

from sqlalchemy import func, select

from app.models import Employee, SalaryRevision


def test_seed_10000_idempotent_reconciles_with_report(monkeypatch, app, client, auth_headers):
    import app.seed as seed_module

    monkeypatch.setattr(seed_module, "app", app)
    assert seed_module.seed() == 10_000
    assert seed_module.seed() == 0
    with app.state.session_maker() as db:
        assert db.scalar(select(func.count()).select_from(Employee)) == 10_000
        assert db.scalar(select(func.count()).select_from(SalaryRevision)) == 10_000
    rows = client.get('/api/employees?page=500&page_size=20', headers=auth_headers)
    assert rows.status_code == 200
    assert rows.json()['total'] == 10_000
    assert len(rows.json()['items']) == 20
    summary = client.get('/api/reports/summary', headers=auth_headers)
    assert summary.status_code == 200
    body = summary.json()
    assert body['headcount'] == 10_000
    assert len(body['by_currency']) == 5
    assert sum(g['headcount'] for g in body['by_currency']) == 10_000
    assert sum(g['headcount'] for g in body['groups']) == 10_000
    assert sum(g['headcount'] for g in body['salary_bands']) == 10_000
    for currency in body['currencies']:
        assert sum(g['headcount'] for g in body['groups'] if g['currency'] == currency) == next(g['headcount'] for g in body['by_currency'] if g['currency'] == currency)
