"""Find file passages and turn their matches into locations in the original."""

import re
from collections import defaultdict

from django.db import connection
from django.db.models import Case, F, Func, TextField, Value, When, Window
from django.db.models.functions import Coalesce, RowNumber

from .models import ItemPassage

MATCH_LIMIT = 5
SNIPPET_CHARS = 220
# Whitespace recognized by str.split() and Python's regex \s. PostgreSQL's
# character classes depend on its locale, so give it the same characters.
WHITESPACE_RUN = (
    "[\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000]+"
)


def matching_passages(items, query):
    # A match must be repeatable at one location in the file. Terms on
    # unrelated pages or in different parts of a recording don't make a hit.
    passages = ItemPassage.objects.filter(
        item__in=items.order_by().values("pk"),
        item__file_index__source=F("item__file"),
    )
    for term in dict.fromkeys(query.split()):
        passages = passages.filter(search_text__contains=term)
    return passages


def _substitutions(passages):
    # Ask the same unaccent dictionary that generated search_text. Unicode
    # decomposition alone misses substitutions such as œ -> oe and ø -> o.
    chars = set()
    for passage in passages:
        if not passage.text.isascii():
            chars.update(re.findall(r"[^\x00-\x7f]", passage.text))
    if not chars:
        return {}
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT c, lower(brain_unaccent(c)) FROM unnest(%s::text[]) AS c",
            [list(chars)],
        )
        return {ord(char): replacement for char, replacement in cursor}


def _spans(text, query, substitutions):
    """Bounds in the original, even when removing accents changes its length."""
    normalized = text.translate(substitutions).lower()
    offsets = range(len(text))
    if not text.isascii() and any(len(s) != 1 for s in substitutions.values()):
        offsets = [
            i for i, char in enumerate(text) for _ in substitutions.get(ord(char), char)
        ]
    terms = query.split()
    found_phrase = False
    for phrase in re.finditer(r"\s+".join(map(re.escape, terms)), normalized):
        found_phrase = True
        yield offsets[phrase.start()], offsets[phrase.end() - 1] + 1
    if found_phrase:
        return
    # In an unordered match center the snippet on the most specific term.
    for term in sorted(terms, key=len, reverse=True):
        start = normalized.find(term)
        if start >= 0:
            yield offsets[start], offsets[start + len(term) - 1] + 1
            return
    yield 0, 0


def _times(passage, start, end):
    """Use the recognizer's supplied timings for words touching the match."""
    cursor = 0
    touched = []
    for word in passage.words:
        token = word["text"].strip()
        if not token:
            continue
        at = passage.text.find(token, cursor)
        if at < 0:
            continue
        if at >= end:
            break
        cursor = at + len(token)
        if cursor > start:
            touched.append(word)
    if touched:
        return touched[0]["start"], touched[-1]["end"]
    return passage.start_seconds, passage.end_seconds


def _location(passage, start, end):
    left = max(0, min(start - SNIPPET_CHARS // 3, len(passage.text) - SNIPPET_CHARS))
    right = left + SNIPPET_CHARS
    snippet = passage.text[left:right].strip()
    if left:
        snippet = "…" + snippet
    if right < len(passage.text):
        snippet += "…"
    start_seconds, end_seconds = _times(passage, start, end)
    location = {
        "text": snippet,
        "page": passage.page,
        "start_seconds": start_seconds,
        "end_seconds": end_seconds,
    }
    if passage.item_id != passage.result_id:
        location["album_image"] = passage.item_id
    return location


def locations(items, result_ids, query):
    # Bound the rows (and transcript word data) fetched per visible result.
    # An album's matching photos share its five places.
    order = ["-phrase", "item__album_position", "position", "pk"]
    passages = (
        matching_passages(items, query)
        .alias(
            flat_text=Func(
                "search_text",
                Value(WHITESPACE_RUN),
                Value(" "),
                Value("g"),
                function="REGEXP_REPLACE",
                output_field=TextField(),
            )
        )
        .annotate(
            result_id=Coalesce("item__album_id", "item_id"),
            # Only the fixed whitespace expression is interpreted as regex.
            phrase=Case(
                When(flat_text__contains=" ".join(query.split()), then=1),
                default=Value(0),
            ),
        )
        .filter(result_id__in=result_ids)
        .annotate(hit=Window(RowNumber(), partition_by="result_id", order_by=order))
        .filter(hit__lte=MATCH_LIMIT)
        .order_by("result_id", *order)
        .defer("search_text")
    )
    substitutions = _substitutions(passages)
    by_result = defaultdict(list)
    for passage in passages:
        hits = by_result[passage.result_id]
        for start, end in _spans(passage.text, query, substitutions):
            if len(hits) == MATCH_LIMIT:
                break
            hit = _location(passage, start, end)
            if not hits or hit != hits[-1]:
                hits.append(hit)
            # A page or image has one destination. Timed words can identify
            # separate occurrences even within a single speech segment.
            if not passage.words:
                break
    return by_result
