# ACME — People & Pay

A working, AI-assisted salary-management assessment submission for HR teams managing 10,000 employees across five countries.


## What it does

- Sign in as the HR administrator. All salary APIs, reports and CSV downloads require a bearer token.
- Browse 10,000 synthetic employees with server-side search, filters, sorting and pagination (20 rows/page).
- Add/edit/deactivate employees. View initial salary and append salary changes with effective date, explanation and HR identity.
- Explore country + department salary breakdowns, headcount, averages, min/max, and salary distribution. Amounts are in integer minor units in the database and **never mixed across currencies**.
- Import a strict CSV with prevalidation + atomic commit, or export filtered rows. Import is **create only**, not an overwrite of salary history.
- Read the one-page requirements, architecture notes, AI-use record and demo script in `docs/`.

## Quick start (recommended: Docker)

Prerequisite: Docker Engine / Docker Desktop and Docker Compose.

1. `cp backend/.env.example backend/.env` (or copy the file manually on Windows).
2. In `backend/.env`, set `JWT_SECRET` to a freshly generated 48+ byte random secret and set a strong `HR_ADMIN_PASSWORD` (at least 12 characters). Keep both private. The demo account email is `hr@acme.example.invalid` unless changed.
3. `docker compose up --build -d`
4. Visit **http://localhost:8000** and sign in with the credentials from your private `.env`.
5. Open the API reference at **http://localhost:8000/api/docs**. The first start seeds 10,000 **fictitious** employees. Re-running is idempotent.
6. `docker compose down` stops the app; `docker compose down -v` **deletes demo data**.

> `compose.yaml` binds to localhost for safer local demonstrations. To deploy publicly, use HTTPS/TLS termination (e.g. managed reverse proxy), secure secrets, persistent storage, backups, and restricted access. Do **not** upload real salaries to this assessment demo.

## Local Python run (without Docker)

Python 3.12+ is recommended. The frontend is served by FastAPI, with a compiled React bundle already included. Node is optional unless editing JSX.

```bash
cd backend
python -m venv .venv
# macOS/Linux: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
# Set these environment variables in your shell (example VALUES ONLY):
export JWT_SECRET='replace-with-a-long-random-secret-using-python-secrets'
export HR_ADMIN_EMAIL='hr@acme.example.invalid'
export HR_ADMIN_PASSWORD='replace-with-a-strong-password'
export DATABASE_URL='sqlite:///./acme.db'
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

PowerShell environment variables use `$env:JWT_SECRET='...'` and similar. `backend/run-dev.sh` is a Linux/macOS alternative that reads a private `backend/.env`. Never commit `.env`.

## Tests

```bash
cd backend
python -m pytest -q
# UI build check, when Node + npm dependencies are available:
cd ../web
npm install
npm run build
node --check app.js
```

The API suite covers auth and unauthorized requests, duplicate IDs/emails, filters and sorting, money precision, salary history, date checks, inactive employees, CSV atomicity, salary-by-currency reporting, and more. GitHub Actions runs these tests on push/PR.

## Project layout

```text
backend/app/      FastAPI endpoints, domain services, auth, SQL models, CSV, reports, seed
backend/tests/    Fast and deterministic API/domain tests
web/src/app.jsx   Readable React JSX source (class components)
web/app.js        Compiled/checked-in browser bundle (no Node needed at runtime)
web/styles.css    Responsive UI styles
web/vendor/       Self-hosted React runtime files and MIT license
Dockerfile        Single app container serving UI + API
compose.yaml      Persistent SQLite volume + local port mapping
docs/             Requirements, architecture, AI use, design, CSV template, demo steps
```

### React build choice

This environment had no access to the npm registry. To keep the deliverable **runnable and browser-ready without dependency downloads**, the checked-in UI bundle uses the self-hosted, MIT-licensed React 16.0.0 UMD runtime and JSX compiled with TypeScript's JSX transformer. The source is in `web/src/app.jsx`; `npm run build` regenerates `web/app.js`. React 16 is intentionally a demo-only dependency; **upgrade to a currently supported React release and bundle with a standard build tool before using the software for real salary information**. The salary API is independent of the frontend runtime.

## Implementation notes

- Current salary is denormalized for indexed queries. Every successful salary update inserts a separate, append-only `salary_revisions` row in the same database transaction.
- `current_salary_minor` is stored as an integer, e.g. 120000.50 USD → 12000050 cents. Reporting and CSV export do not sum unlike currencies.
- Salary dates are calendar dates. Future-dated changes, backdating before the latest revision, no-op salary changes and salary edits for inactive employees are rejected.
- CSV fields: `employee_code,full_name,email,country,department,job_title,annual_salary,currency`; see [template](docs/import-template.csv). Formula-like text is made inert on export.
- The v1 UI has a single HR role; SSO/MFA/approvals and per-country data access are out of scope, as is payroll execution and automatic FX conversion.

## Verification & scope limitations

This repository contains functioning backend/API code, 10,000-data seeder, automated tests, a complete React UI with checked-in browser JavaScript, and a working Docker specification. The app has been exercised in a local Python environment and API tests are runnable. A **public hosting URL, GitHub push and human screen-recorded video are not included**—they require the candidate's external accounts and browser/recording environment. Use [`docs/DEMO.md`](docs/DEMO.md) as the video walkthrough script and commit your demo video or its link when recorded.

## Submitted design artifacts

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — single-page scope + acceptance criteria
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — flow and database relationships
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture, scale, privacy and exclusions
- [`docs/AI_USAGE.md`](docs/AI_USAGE.md) — AI prompts and verification approach
- [`docs/DEMO.md`](docs/DEMO.md) — video demonstration plan

See `git log --oneline --reverse` for incremental design, API, UI, tests and packaging commits.
