# One image for every Python service (api, worker, migrate).
# The frontend is built in its own stage and served by Django as static files.

FROM node:24.11-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Tailwind reads the classes of a blog's pages from its templates, and the
# typecheck the data the parity test shares with the backend.
COPY backend/apps/public/ /backend/apps/public/
RUN npm run build


FROM python:3.12-slim-trixie AS app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ENVIRONMENT=production \
    FRONTEND_DIST_DIR=/app/frontend_dist \
    STORAGE_PATH=/data/storage \
    BACKUP_DIR=/data/backups \
    EXPORT_DIR=/data/exports

# postgresql-client: pg_dump for the scheduled database backups. Trixie ships
# version 17, matching the pgvector/pgvector:*-pg17 server.
# libmagic1: detects the real type of uploaded files (python-magic).
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client curl libmagic1 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1000 brainbro \
    && useradd --system --uid 1000 --gid brainbro --home /app brainbro

WORKDIR /app

# Exported from Poetry with `make exportdeps`.
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

COPY backend/ /app/
COPY --from=frontend /frontend/dist /app/frontend_dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint

RUN chmod +x /usr/local/bin/entrypoint \
    && SECRET_KEY=build APP_HOSTNAMES=build python manage.py collectstatic --no-input \
    && mkdir -p /data/storage /data/backups /data/exports \
    && chown -R brainbro:brainbro /data

USER brainbro

EXPOSE 8000

ENTRYPOINT ["entrypoint"]
CMD ["api"]
