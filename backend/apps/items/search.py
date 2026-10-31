"""
Full-text search over items.

Every item keeps two generated columns, refreshed by Postgres on every save:
`search_text` (everything searchable, lowercased and without accents, with
a trigram index) to find matches, and `search_vector` (the same words,
weighted: title, then link and file details, then the body) to rank them.

Items with every word of the query come first, then items with only some of
them, ranked by how many. A word that appears nowhere as written is taken for
a typo and matches similar words instead (only for longer words). Then
matches on the title rank first; typos rank below exact words.
"""

import re

from django.contrib.postgres.search import (
    SearchQuery,
    SearchRank,
    SearchVector,
    TrigramWordSimilarity,
)
from django.db import connection
from django.db.models import Case, F, FloatField, Func, Q, TextField, Value, When
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Coalesce, Concat, Lower

# Mixed languages: no stemming, so Spanish and English words both match.
CONFIG = "simple"
# Link previews and uploads.
METADATA_KEYS = ("title", "description", "site_name", "author", "filename", "final_url")
# Shorter words only match as written: a typo leaves too little to go on.
TYPO_MIN_LENGTH = 4
# How close a word has to be to count as a typo (pg_trgm's default is 0.6,
# which misses common ones like "mardown").
TYPO_THRESHOLD = "0.5"
# Shorter words ("a", "to", "de") are in almost everything: they only make a
# match when every word is there, and never add to the rank.
PARTIAL_MIN_LENGTH = 3


class Unaccent(Func):
    """`unaccent()`, wrapped as immutable so generated columns can use it."""

    function = "brain_unaccent"
    output_field = TextField()


def _joined(*expressions):
    parts = []
    for expression in expressions:
        parts += [Coalesce(expression, Value(""), output_field=TextField()), Value(" ")]
    return Concat(*parts[:-1], output_field=TextField())


def _details():
    return _joined("url", *(KeyTextTransform(key, "metadata") for key in METADATA_KEYS))


def search_text():
    return Lower(Unaccent(_joined("title", _details(), "body")))


def search_vector():
    return (
        SearchVector(Unaccent("title"), config=CONFIG, weight="A")
        + SearchVector(Unaccent(_details()), config=CONFIG, weight="B")
        + SearchVector(Unaccent("body"), config=CONFIG, weight="C")
    )


def normalize(text):
    """The query as `search_text` stores words: lowercase, no accents."""
    with connection.cursor() as cursor:
        # The threshold is set here, on the connection that runs the search.
        cursor.execute(
            "SELECT lower(brain_unaccent(%s)), "
            "set_config('pg_trgm.word_similarity_threshold', %s, false)",
            [text, TYPO_THRESHOLD],
        )
        return cursor.fetchone()[0]


def find(items, text):
    """
    `items` matching `text`, annotated with `rank` (higher is better): the
    number of longer words that match, plus a relevance score below 1.
    """
    query = normalize(text)
    every, some, matched = Q(), Q(pk__in=[]), Value(0.0)
    for term in query.split():
        match = Q(search_text__contains=term)
        # Similar words only stand in for one that isn't there: "paris"
        # shouldn't bring up "parts" when there are notes about Paris.
        if len(term) >= TYPO_MIN_LENGTH and not items.filter(match).exists():
            match = Q(search_text__trigram_word_similar=term)
        every &= match
        if len(term) >= PARTIAL_MIN_LENGTH:
            some |= match
            matched += Case(
                When(match, then=1.0), default=0.0, output_field=FloatField()
            )
    items = items.filter(every | some)
    # Word prefixes, so a word being typed already ranks its matches.
    prefixes = " | ".join(f"{word}:*" for word in re.findall(r"\w+", query))
    relevance = TrigramWordSimilarity(Value(query), "search_text") * 0.1
    if prefixes:
        tsquery = SearchQuery(prefixes, config=CONFIG, search_type="raw")
        relevance += SearchRank(F("search_vector"), tsquery)
    # Squeezed below 1, so one more matching word always ranks higher.
    return items.annotate(relevance=relevance).annotate(
        rank=matched + F("relevance") / (F("relevance") + 1.0)
    )
