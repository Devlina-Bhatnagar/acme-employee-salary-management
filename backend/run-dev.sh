#!/usr/bin/env bash
set -euo pipefail
# For local development only; copy .env.example into your own .env first.
if [[ ! -f .env ]]; then echo 'Create backend/.env from .env.example and replace the secrets' >&2; exit 1; fi
set -a; source .env; set +a
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
