"""
Client for the embedder container (docker/embedder), which turns text into
vectors that are close when the texts mean similar things, in Spanish,
English and ~50 other languages. Off when EMBEDDER_URL is empty.
"""

import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# paraphrase-multilingual-MiniLM-L12-v2, the model the container is built with.
DIMENSIONS = 384
# Searches wait for it: a slow or missing embedder leaves them to words alone.
QUERY_TIMEOUT = (0.5, 2)
BATCH_TIMEOUT = (2, 60)
# The container refuses more in one request.
MAX_TEXTS = 256


class EmbedderUnavailable(Exception):
    pass


def enabled():
    return bool(settings.EMBEDDER_URL)


def embed(texts, timeout=BATCH_TIMEOUT):
    """One vector per text, in order."""
    url = f"{settings.EMBEDDER_URL.rstrip('/')}/embed"
    try:
        response = requests.post(url, json={"texts": texts}, timeout=timeout)
        response.raise_for_status()
        vectors = response.json()["vectors"]
    except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
        raise EmbedderUnavailable(str(exc)) from exc
    if len(vectors) != len(texts):
        raise EmbedderUnavailable(f"{len(vectors)} vectors for {len(texts)} texts")
    return vectors


def query_vector(text):
    """The vector of a search, or None when there is no embedder to ask."""
    if not enabled():
        return None
    try:
        return embed([text], timeout=QUERY_TIMEOUT)[0]
    except EmbedderUnavailable as exc:
        logger.warning("Searching by words only, no embedder: %s", exc)
        return None
