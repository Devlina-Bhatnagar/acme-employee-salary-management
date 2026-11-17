# AI-assisted development record

The assessment requested intentional AI use. This repository was initially generated with GPT-6 as a coding assistant; the developer retained responsibility for defining the scope, business rules, testing, and review. Further agent instructions can be logged here during iteration.

## Tasks delegated to AI
- Convert the product brief into a one-page scope with explicit non-goals.
- Scaffold a FastAPI/SQLAlchemy API and React client around testable salary-change invariants.
- Propose tests for authentication, pagination, currency grouping, history, imports and invalid requests.
- Suggest local deployment, security and performance trade-offs.

## Verification checklist
- Run automated API tests and browser smoke tests where supported.
- Inspect monetary types and cross-currency reporting for correctness.
- Verify imports are transactional and salary revisions remain append-only.
- Review all authentication and exposed fields, rather than trusting generated code.
- Keep the Git history incremental; record limitations honestly in README.

## Sample continuation prompts for a coding agent
1. `Review SalaryService for invariants: integer minor units, allowed country/currency, immutable salary history, and transactional changes. Propose edge-case tests; don't silently change requirements.`
2. `Audit report queries for mixed-currency aggregation errors and demonstrate reconciliation with SQL fixtures.`
3. `Review CSV import for spreadsheet formula injection, duplicate IDs and atomic rollback; produce failing tests before fixes.`
4. `Assess 10,000-record directory query plans and recommend indexes without premature caching or microservices.`
