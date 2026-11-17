# 10,000-employee performance smoke check

A one-off local HTTP run against a SQLite database seeded with 10,000 synthetic employees (five countries, eight departments), using Uvicorn with one worker. The figures below describe this environment only, not guaranteed production response times.

| Operation | Response | Observed wall time |
| --- | --- | ---: |
| HR login (PBKDF2 password verification) | 200 | 50 ms |
| Employee directory, 20 items | 200 | 11 ms |
| Currency-separated salary summary | 200 | 40 ms |
| Employee search | 200 | 21 ms |
| Export employees filtered to Germany | 200 | 35 ms |
| Create employee & initial revision | 201 | 9 ms |
| Append salary change & history | 200 | 8 ms |

Execution: `python scripts/http_smoke.py` against a running, demo-only server, using `BASE_URL`, `HR_ADMIN_EMAIL`, and `HR_ADMIN_PASSWORD` in the shell. The script creates one additional synthetic employee and salary revision; do not use it with live HR data.

**Scale design:** Directory paginates in SQL rather than loading 10k rows into the client. Filtering uses SQLAlchemy prepared expressions with indexes for name, country/department/status and salary. Aggregates compute in SQLite, never in UI JavaScript. Seed creation uses 1,000-record batches and is idempotent. CSV import is transactionally atomic but may be slower for 10k rows; background jobs, managed PostgreSQL, index analysis (`EXPLAIN`), backups and write-concurrency testing are deferred to a real production environment. All report amounts are split by currency; raw cross-currency salary sorting is forbidden.

**Limitations:** No concurrent user load tests, browser rendering test or cloud deployment was possible in the local assessment sandbox. A CI runner installs dependencies and executes API and JavaScript syntax/build verification, but interactive UI workflows must be smoke-tested from an actual browser before candidate submission.
