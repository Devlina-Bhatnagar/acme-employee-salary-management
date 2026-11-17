# ACME Salary Manager — One-page product requirements (v1)

**Persona:** ACME HR manager responsible for salary records for 10,000 employees in several countries.  
**Problem:** Spreadsheets make finding, updating, auditing, and explaining compensation slow and error-prone.  
**Goal:** An HR manager can securely maintain employee salary records and answer basic, defensible compensation questions without stitching together spreadsheets.

## In scope — MVP
1. **Access & trust:** HR-only sign-in, protected API, server-side validation, change history, and synthetic demo data. No public salary access.
2. **Employee directory:** Search by name/employee ID/email; filter by country, department and employment status; paginate and sort 10,000 records; create and edit employee profile; deactivate an employee rather than deleting historical data.
3. **Salary management:** Store annual *base* salary in each employee's local currency, as integer minor units. View current salary and append a reasoned, effective-dated salary revision. Show who made each change and when. Salary revisions must be effective today or earlier, in non-decreasing effective-date order, and cannot be made for inactive employees.
4. **Questions HR can answer:** Headcount, salary total/average/min/max and country/department breakdown; salary bands/distribution; export filtered records to CSV. Each total or average is strictly scoped to one currency; never silently sum INR, USD, EUR, etc.
5. **Spreadsheet transition:** Import employees using CSV with clear validation, all-or-nothing behavior, and duplicate employee-ID protection. Provide an example CSV template.
6. **Demo/readiness:** Deterministic 10,000-employee seed, health endpoint, documented local and Docker deployment, automated unit/API tests, and a reproducible demo walkthrough.

## Out of scope and why
- **Payroll execution, tax, payslips, bonuses, equity, benefits:** materially different, country-specific regulated workflows; base compensation only.
- **Exchange-rate conversion and cross-currency global salary totals:** require dated authoritative FX rates and agreed accounting conventions; local-currency facts are safer.
- **Market benchmarking and pay-equity/inference:** require approved external datasets, sensitive personal attributes and validated methodology.
- **SSO, multi-tenant access and granular approvals:** enterprise integration work not required to validate the core workflow; use a single HR-admin role now, with extension points documented.
- **Predictive or free-form AI analytics:** can hallucinate compensation data; precise filterable aggregates are more trustworthy for v1.
- **Bulk updates of existing salary history:** potentially destructive; new salary revisions must be explicit and traceable.

## Acceptance criteria
- 10,000 deterministic employees appear after one seed command; reseeding does not duplicate data.
- A signed-in HR manager can browse/search/filter, create an employee, edit their profile, update annual salary and inspect salary history.
- Invalid currency/amount/date, duplicate IDs, unauthorized access and malformed imports fail safely without partial writes.
- Reporting totals reconcile with underlying employees **within each currency**; filters consistently apply to directory, reports and export.
- Automated tests cover critical validation, authorization, revision history, reporting, importing and pagination; start/run instructions work from a clean checkout.

**Success measure:** HR can answer “What is the average annual base salary in engineering in Germany?” and update an individual salary with a visible reason and audit history in a few steps.
