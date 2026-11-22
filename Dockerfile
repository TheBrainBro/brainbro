# One image for every Python service (api, worker, migrate).
# The frontend is built in its own stage and served by Django as static files.

# The frontend and the dependency list don't depend on the target platform,
# so they run on the builder's own one: no emulation for the arm64 image.
FROM --platform=$BUILDPLATFORM node:26.13-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Tailwind reads the classes of a blog's pages from its templates, and the
# typecheck the data the parity test shares with the backend.
COPY backend/apps/public/ /backend/apps/public/
RUN npm run build


# The dependency list comes straight from poetry.lock, so the image installs
# exactly what is locked and no exported file has to be kept in sync.
FROM --platform=$BUILDPLATFORM python:3.12-slim-trixie AS requirements
RUN pip install --no-cache-dir poetry==2.3.2 poetry-plugin-export==1.10.0
WORKDIR /backend
COPY backend/pyproject.toml backend/poetry.lock ./
RUN poetry export -f requirements.txt --output requirements.txt --without-hashes


# whisper.cpp v1.8.3, compiled for the image architecture. Ship the model with
# the worker so transcription needs no credentials or runtime downloads.
FROM debian:trixie-slim AS whisper
WORKDIR /build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl cmake g++ make \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 3 -o source.tar.gz https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/2eeeba56e9edd762b4b38467bab96c2517163158 \
    && tar -xzf source.tar.gz --strip-components=1 \
    && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
        -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
    && cmake --build build --config Release --target whisper-cli -j2
RUN curl -fsSL --retry 3 -o ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/80da2d8bfee42b0e836fc3a9890373e5defc00a6/ggml-tiny.bin \
    && echo 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21  ggml-tiny.bin' | sha256sum -c - \
    && curl -fsSL --retry 3 -o model-license https://raw.githubusercontent.com/openai/whisper/v20250625/LICENSE

FROM python:3.12-slim-trixie AS media-tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa \
    && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /build/build/bin/whisper-cli /usr/local/bin/
COPY --from=whisper /build/ggml-tiny.bin /usr/local/share/whisper/
COPY --from=whisper /build/LICENSE /build/model-license /usr/local/share/doc/whisper/

FROM media-tools AS app

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

COPY --from=requirements /backend/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

COPY backend/ /app/
COPY LICENSE TRADEMARKS.md THIRD_PARTY_NOTICES.md /app/
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
