FROM python:3.12-slim
WORKDIR /srv/acme
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATABASE_URL=sqlite:////data/acme.db
COPY backend/requirements.txt /srv/acme/backend/requirements.txt
RUN pip install --no-cache-dir -r /srv/acme/backend/requirements.txt
COPY backend/app /srv/acme/backend/app
COPY web /srv/acme/web
COPY docs/import-template.csv /srv/acme/docs/import-template.csv
RUN useradd --system --uid 10001 --home /srv/acme acme && mkdir -p /data && chown 10001:10001 /data
USER acme
WORKDIR /srv/acme/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=3)" || exit 1
CMD ["sh", "-c", "if [ \"${SEED_DEMO:-false}\" = 'true' ]; then python -m app.seed; fi; exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]
