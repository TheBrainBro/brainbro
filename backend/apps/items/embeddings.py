"""
What semantic search searches: each item's text, cut into chunks the model
reads whole (it stops after ~128 tokens), each stored with its vector
(`ItemChunk`).

`embed_stale` keeps them up to date. An item is stale when its `search_text`
changed since its chunks were made (`embedded_hash`), which covers every way
text changes (edits, link previews, imports) and items from before semantic
search, with nothing to call on save. It runs every minute; until then, new
text is found by its words.
"""

import logging
import re
import time

from django.db import transaction
from django.db.models import F
from django.db.models.functions import MD5

from . import embedder
from .models import Item, ItemChunk

logger = logging.getLogger(__name__)

# ~100 tokens, so the title in front of each chunk still fits.
CHUNK_CHARS = 400
TITLE_CHARS = 120
# Past ~25k characters, the rest of a very long note is found by its words.
MAX_CHUNKS = 64
DETAIL_KEYS = ("description", "site_name", "author", "filename")
BATCH_ITEMS = 16
# Seconds per run, well under the minute between runs.
TIME_BUDGET = 45

_PARAGRAPHS = re.compile(r"\n\s*\n")
_SENTENCES = re.compile(r"(?<=[.!?…])\s+")
# Link targets and bare URLs: noise to the model.
_LINK_TARGETS = re.compile(r"\]\([^)]*\)")
_URLS = re.compile(r"https?://\S+")


def chunks(item):
    """The texts to embed for `item`: its details and body, each with its title."""
    metadata = item.metadata or {}
    title = (item.title or _string(metadata.get("title"))).strip()[:TITLE_CHARS]
    details = " ".join(_string(metadata.get(key)) for key in DETAIL_KEYS).strip()
    body = _URLS.sub("", _LINK_TARGETS.sub("]", item.body))
    prefix = f"{title}\n" if title else ""
    texts = [
        prefix + piece
        for piece in _pack(f"{details}\n\n{body}", CHUNK_CHARS - len(prefix))
    ]
    if not texts and title:
        texts = [title]
    return texts[:MAX_CHUNKS]


def _string(value):
    return value if isinstance(value, str) else ""


def _pack(text, size):
    """Paragraphs joined up to `size` characters; longer ones cut to fit."""
    packed = []
    for unit in _units(text, size):
        if packed and len(packed[-1]) + 1 + len(unit) <= size:
            packed[-1] += "\n" + unit
        else:
            packed.append(unit)
    return packed


def _units(text, size):
    for paragraph in _PARAGRAPHS.split(text):
        paragraph = " ".join(paragraph.split())
        if len(paragraph) <= size:
            if paragraph:
                yield paragraph
            continue
        for sentence in _SENTENCES.split(paragraph):
            while len(sentence) > size:
                cut = sentence.rfind(" ", 0, size + 1)
                cut = cut if cut > 0 else size
                yield sentence[:cut]
                sentence = sentence[cut:].lstrip()
            if sentence:
                yield sentence


def stale_items():
    """Items whose chunks don't match their text, newest first."""
    return (
        Item.objects.annotate(content_hash=MD5("search_text"))
        .exclude(embedded_hash=F("content_hash"))
        .order_by("-updated_at")
    )


def embed_stale(budget=TIME_BUDGET):
    """
    Make the chunks of stale items, a batch at a time, for up to `budget`
    seconds. Returns how many items were done.
    """
    if not embedder.enabled():
        return 0
    started, done, seen = time.monotonic(), 0, set()
    while time.monotonic() - started < budget:
        batch = list(stale_items().exclude(id__in=seen)[:BATCH_ITEMS])
        if not batch:
            break
        texts = {item.id: chunks(item) for item in batch}
        flat = [text for item_texts in texts.values() for text in item_texts]
        try:
            vectors = iter(_embed_all(flat))
        except embedder.EmbedderUnavailable as exc:
            logger.warning("Embedding stopped, no embedder: %s", exc)
            break
        for item in batch:
            item_vectors = [next(vectors) for _ in texts[item.id]]
            _store(item, texts[item.id], item_vectors)
            seen.add(item.id)
        done += len(batch)
    return done


def _embed_all(texts):
    vectors = []
    for start in range(0, len(texts), embedder.MAX_TEXTS):
        vectors += embedder.embed(texts[start : start + embedder.MAX_TEXTS])
    return vectors


def _store(item, texts, vectors):
    with transaction.atomic():
        # Locked so two runs can't both replace the chunks of one item.
        if not Item.objects.select_for_update().filter(id=item.id).exists():
            return  # deleted meanwhile
        ItemChunk.objects.filter(item=item).delete()
        ItemChunk.objects.bulk_create(
            ItemChunk(item=item, position=position, text=text, embedding=vector)
            for position, (text, vector) in enumerate(zip(texts, vectors))
        )
        # The hash of the text these chunks came from: if it changed since,
        # the item stays stale and the next run does it again.
        Item.objects.filter(id=item.id).update(embedded_hash=item.content_hash)
