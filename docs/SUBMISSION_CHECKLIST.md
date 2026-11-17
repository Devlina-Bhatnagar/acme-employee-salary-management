# Submission checklist

## Included in this source repository
- [x] One-page requirements PDF and editable Markdown (committed before application code)
- [x] FastAPI backend and self-hosted React UI, salary update and history workflows
- [x] Relational SQLite schema, currency-safe reporting, indexed paging, transactional CSV import/export
- [x] Deterministic and idempotent seed for 10,000 employees
- [x] Automated tests (16 passing; 93% local statement coverage)
- [x] Docker configuration, local setup, `/api/health` and CI pipeline
- [x] Architecture, design trade-offs, performance notes, AI-use record, demo walkthrough
- [x] Incremental local Git commits representing delivery stages

## Candidate actions that require external access
- [ ] Run and manually verify all UI screens in a desktop browser (sandbox browser access was restricted).
- [ ] Upgrade the self-hosted legacy React demo runtime to a supported version before any real-data deployment.
- [ ] Deploy to an HTTPS-protected host with persistent storage and managed secrets; do not use real salaries in an assessment demo.
- [ ] Record a browser video following `docs/DEMO.md`, avoiding passwords and sensitive information.
- [ ] Push this repository and its existing Git history to your own GitHub/GitLab account.
- [ ] Reply to the assessment email with repository and deployment/video links.

**No public deployment or GitHub push was carried out in the supplied execution environment.**
