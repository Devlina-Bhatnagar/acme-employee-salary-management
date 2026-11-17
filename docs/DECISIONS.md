# Engineering decisions and trade-offs

- **API-first modular monolith:** FastAPI, SQLAlchemy, SQLite. Fast to reason about and deploy at 10k employees, with service functions separating domain rules from HTTP transport.
- **Salary integer minor units:** precise currency calculations, never floating-point for persisted pay; currency locked to an employee record once salary history exists.
- **Append-only compensation events:** `salary_revisions` is immutable through the API. `employees.current_salary_minor` is a denormalized current snapshot updated within the same database transaction for fast search/report; tests assert consistency.
- **Explicit reporting grain:** Groups include country, department and currency; no misleading cross-currency single total. All monetary values in API are minor units, and UI labels amounts using `Intl.NumberFormat`.
- **Import is strict:** CSV create-only and transactional, with a 10,000-row limit. Prevalidation catches duplicates before writing, preventing a partially imported workforce. Export begins with a BOM for spreadsheet interoperability and escapes formula-like strings.
- **Auth:** One HR-admin account loaded from environment. PBKDF2-SHA256 password hashing, short-lived signed JWT, request-scoped identity. Production requires supplied credentials and secret. This is not enterprise SSO/RBAC.
- **Dates:** Effective dates are UTC calendar dates (ISO); the UI labels the field UTC for clarity. API rejects future effective dates and any revision before the latest recorded effective date; same-day changes allowed and ordered by creation/ID. Audit timestamps are UTC.
- **Meaningful salary ordering:** Salary sorting requires a single country filter, avoiding false numeric comparisons across currencies.
- **Performance:** Indexed directory filters, server pagination, SQL aggregate reporting. No fetching 10k rows into the web browser; seed is deterministic. At 10k employees SQLite is a pragmatic take-home choice, not a production multi-writer architecture.
- **Security/privacy:** Synthetic data only; protected endpoints and exports, no credentials in Git, audit trail, validated input, no SQL string concatenation; process behind HTTPS in deployment.
- **Deferred production hardening:** SSO/MFA, per-country HR permissions, managed PostgreSQL, backups/restore drills, stronger audit immutability, rate limiting and monitoring. These matter before real salary data is onboarded.
