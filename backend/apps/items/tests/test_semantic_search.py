import math
import zlib

import pytest
import requests

from apps.items import embedder, embeddings
from apps.items.models import Item, ItemChunk
from apps.items.tasks import embed_items

# Words that mean the same to the fake model.
CONCEPTS = {
    "paris": "france",
    "francia": "france",
    "france": "france",
    "trip": "travel",
    "viaje": "travel",
    "vacaciones": "travel",
    "taxes": "tax",
    "impuestos": "tax",
}


def fake_vector(text):
    """
    Close for texts that share concepts, like the real model, which also
    makes little of short words.
    """
    vector = [0.0] * embedder.DIMENSIONS
    for word in text.lower().split():
        word = word.strip(".,:;!?")
        if len(word) < 4:
            continue
        vector[zlib.crc32(CONCEPTS.get(word, word).encode()) % len(vector)] += 1
    norm = math.sqrt(sum(value * value for value in vector)) or 1
    return [value / norm for value in vector]


@pytest.fixture
def requests_seen():
    return []


@pytest.fixture
def fake_embedder(settings, monkeypatch, requests_seen):
    settings.EMBEDDER_URL = "http://embedder.test"

    def embed(texts, timeout=None):
        requests_seen.append(texts)
        return [fake_vector(text) for text in texts]

    monkeypatch.setattr(embedder, "embed", embed)


@pytest.fixture
def embedder_down(settings, monkeypatch):
    settings.EMBEDDER_URL = "http://embedder.test"

    def embed(texts, timeout=None):
        raise embedder.EmbedderUnavailable("connection refused")

    monkeypatch.setattr(embedder, "embed", embed)


def search(api, query):
    response = api.get("/api/items/search/", {"q": query})
    assert response.status_code == 200
    return [result["item"]["id"] for result in response.json()]


def note(user, body, **fields):
    return Item.objects.create(owner=user, kind="note", body=body, **fields)


# Chunks


def test_chunks_carry_the_title_and_the_details():
    link = Item(
        kind="link",
        url="https://example.com",
        metadata={"title": "Sourdough", "description": "A starter guide", "width": 3},
    )
    assert embeddings.chunks(link) == ["Sourdough\nA starter guide"]


def test_long_text_is_cut_into_chunks_the_model_reads_whole():
    paragraph = "word " * 150
    item = Item(kind="note", title="Notes", body=f"Short one.\n\n{paragraph}")
    texts = embeddings.chunks(item)
    assert texts[0].startswith("Notes\nShort one.")
    assert len(texts) > 2
    assert all(len(text) <= embeddings.CHUNK_CHARS for text in texts)
    assert all(text.startswith("Notes\n") for text in texts)


def test_short_paragraphs_share_a_chunk():
    item = Item(kind="note", body="One.\n\nTwo.\n\nThree.")
    assert embeddings.chunks(item) == ["One.\nTwo.\nThree."]


def test_urls_are_left_out():
    item = Item(
        kind="note", body="See [the docs](https://example.com/x) or https://a.b/c"
    )
    assert embeddings.chunks(item) == ["See [the docs] or"]


def test_very_long_notes_stop_at_the_chunk_limit():
    item = Item(kind="note", body="\n\n".join(["x " * 190] * 100))
    assert len(embeddings.chunks(item)) == embeddings.MAX_CHUNKS


def test_an_item_without_text_has_no_chunks():
    assert embeddings.chunks(Item(kind="image", metadata={"width": 10})) == []


# Keeping chunks up to date


def test_stale_items_get_their_chunks(user, fake_embedder):
    item = note(user, "Vacaciones en Francia", title="Abril")
    empty = Item.objects.create(owner=user, kind="image")

    assert embed_items() == 2

    chunk = ItemChunk.objects.get()
    assert (chunk.item, chunk.position) == (item, 0)
    assert chunk.text == "Abril\nVacaciones en Francia"
    assert len(chunk.embedding) == embedder.DIMENSIONS
    assert not embeddings.stale_items().filter(id__in=[item.id, empty.id]).exists()


def test_only_changed_text_is_embedded_again(user, fake_embedder, requests_seen):
    item = note(user, "first draft")
    embeddings.embed_stale()
    requests_seen.clear()
    # As a request would load it: with the hash of its chunks.
    item.refresh_from_db()

    item.status = Item.Status.ARCHIVED
    item.save()
    assert embeddings.embed_stale() == 0

    item.body = "final version"
    item.save()
    assert embeddings.embed_stale() == 1
    assert requests_seen == [["final version"]]
    assert ItemChunk.objects.get().text == "final version"


def test_text_changed_without_a_save_counts_too(user, fake_embedder):
    link = Item.objects.create(owner=user, kind="link", url="https://example.com")
    embeddings.embed_stale()
    # As a link preview stores what it found.
    Item.objects.filter(id=link.id).update(metadata={"title": "Taxes in Spain"})
    assert embeddings.embed_stale() == 1
    assert ItemChunk.objects.get().text == "Taxes in Spain"


def test_nothing_runs_without_an_embedder(user, settings):
    settings.EMBEDDER_URL = ""
    note(user, "anything")
    assert embeddings.embed_stale() == 0


def test_items_stay_stale_while_the_embedder_is_down(user, embedder_down):
    item = note(user, "anything")
    assert embeddings.embed_stale() == 0
    assert embeddings.stale_items().filter(id=item.id).exists()


# Searching


def test_finds_items_by_meaning_without_a_shared_word(api, user, fake_embedder):
    trip = note(user, "Vacaciones en Francia")
    note(user, "Lista de la compra")
    embeddings.embed_stale()

    assert search(api, "paris trip") == [str(trip.id)]


def test_items_with_every_word_still_come_first(api, user, fake_embedder):
    trip = note(user, "Vacaciones en Francia")
    words = note(user, "a paris trip, maybe")
    embeddings.embed_stale()

    assert search(api, "paris trip") == [str(words.id), str(trip.id)]


def test_in_a_sentence_meaning_beats_a_partial_match(api, user, fake_embedder):
    trip = note(user, "Vacaciones en Francia")
    notes = note(user, "meeting notes")
    embeddings.embed_stale()

    query = "notes about the trip to paris"
    assert search(api, query) == [str(trip.id), str(notes.id)]


def test_one_word_goes_by_its_matches_first(api, user, fake_embedder):
    meaning = note(user, "Impuestos del trimestre")
    word = note(user, "taxes are due, and rent")
    embeddings.embed_stale()

    assert search(api, "taxes") == [str(word.id), str(meaning.id)]


def test_unrelated_items_dont_match_by_meaning(api, user, fake_embedder):
    note(user, "Lista de la compra")
    embeddings.embed_stale()
    assert search(api, "paris trip") == []


def test_only_the_users_items_match_by_meaning(api, other_user, fake_embedder):
    note(other_user, "Vacaciones en Francia")
    embeddings.embed_stale()
    assert search(api, "paris trip") == []


def test_list_filters_use_meaning_too(api, user, fake_embedder):
    trip = note(user, "Vacaciones en Francia")
    note(user, "Viaje archivado a Francia", status=Item.Status.ARCHIVED)
    embeddings.embed_stale()

    response = api.get("/api/items/", {"q": "paris trip", "status": "inbox"})
    assert [item["id"] for item in response.json()["results"]] == [str(trip.id)]


def test_search_goes_by_words_while_the_embedder_is_down(api, user, embedder_down):
    words = note(user, "paris trip")
    assert search(api, "paris trip") == [str(words.id)]


# The embedder client


class Response:
    def __init__(self, data, status=200):
        self.data, self.status = data, status

    def raise_for_status(self):
        if self.status >= 400:
            raise requests.HTTPError(str(self.status))

    def json(self):
        return self.data


def test_embed_posts_the_texts(settings, monkeypatch):
    settings.EMBEDDER_URL = "http://embedder:8000/"
    sent = {}

    def post(url, json, timeout):
        sent.update(url=url, json=json)
        return Response({"vectors": [[0.1], [0.2]]})

    monkeypatch.setattr(requests, "post", post)
    assert embedder.embed(["a", "b"]) == [[0.1], [0.2]]
    assert sent == {"url": "http://embedder:8000/embed", "json": {"texts": ["a", "b"]}}


@pytest.mark.parametrize(
    "outcome",
    [
        requests.ConnectionError("refused"),
        Response({"error": "Too large."}, status=413),
        Response({"unexpected": True}),
        Response({"vectors": []}),  # fewer than asked for
    ],
)
def test_embedder_failures_are_unavailable(settings, monkeypatch, outcome):
    settings.EMBEDDER_URL = "http://embedder:8000"

    def post(url, json, timeout):
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(requests, "post", post)
    with pytest.raises(embedder.EmbedderUnavailable):
        embedder.embed(["a", "b"])
    assert embedder.query_vector("a") is None


def test_no_query_vector_without_an_embedder(settings):
    settings.EMBEDDER_URL = ""
    assert embedder.query_vector("anything") is None
