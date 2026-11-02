# Turns text into vectors for semantic search (apps.items.embeddings). The
# model is downloaded here, at build time: the running container never goes
# online, and the api and worker share one copy of it in memory.
FROM python:3.12-slim-trixie

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 \
    MODEL_DIR=/models

COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

RUN groupadd --system --gid 1000 embedder \
    && useradd --system --uid 1000 --gid embedder --create-home --home /app embedder \
    && mkdir "$MODEL_DIR" && chown embedder:embedder "$MODEL_DIR"
USER embedder

COPY server.py /app/server.py
RUN python /app/server.py download

# Only the model already in the image.
ENV HF_HUB_OFFLINE=1
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
    CMD ["python", "/app/server.py", "check"]
CMD ["python", "/app/server.py"]
