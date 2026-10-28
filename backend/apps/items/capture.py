"""
Infer what was captured from raw text.

Rule: text that is exactly one URL becomes a link; anything else becomes a
note, URLs included. Pasted text is never split into several items: it stays
as dropped, and sorting comes later.
"""

from django.core.exceptions import ValidationError
from django.core.validators import URLValidator

from .models import Item

MAX_URL_LENGTH = 2048

_validate_url = URLValidator(schemes=["http", "https"])


def normalize_url(text):
    """Return `text` as an http(s) URL, or None if it is not exactly one URL."""
    candidate = text.strip().removeprefix("<").removesuffix(">")
    if not candidate or any(c.isspace() for c in candidate):
        return None
    if candidate.lower().startswith("www."):
        candidate = f"https://{candidate}"
    if len(candidate) > MAX_URL_LENGTH:
        return None
    try:
        _validate_url(candidate)
    except ValidationError:
        return None
    return candidate


def infer_item_fields(text):
    """Field values for an Item captured from `text` (already non-empty)."""
    url = normalize_url(text)
    if url:
        return {"kind": Item.Kind.LINK, "url": url}
    return {"kind": Item.Kind.NOTE, "body": text.strip()}
