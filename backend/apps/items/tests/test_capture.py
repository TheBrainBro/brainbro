import pytest
from rest_framework.test import APIClient

from apps.items.capture import infer_item_fields, normalize_url
from apps.items.models import Collection, Item


@pytest.mark.parametrize(
    "text,expected",
    [
        ("https://example.com/a?b=1", "https://example.com/a?b=1"),
        ("  http://example.com  \n", "http://example.com"),
        ("<https://example.com>", "https://example.com"),
        ("www.example.com/x", "https://www.example.com/x"),
        ("example.com", None),
        ("ftp://example.com", None),
        ("javascript:alert(1)", None),
        ("see https://example.com", None),
        ("https://a.io https://b.io", None),
    ],
)
def test_normalize_url(text, expected):
    assert normalize_url(text) == expected


def test_text_with_urls_stays_one_note():
    fields = infer_item_fields("  Read https://a.io and https://b.io later \n")
    assert fields == {
        "kind": Item.Kind.NOTE,
        "body": "Read https://a.io and https://b.io later",
    }


def test_capture_text_creates_inbox_note(api, user):
    response = api.post("/api/items/capture/", {"text": "Buy milk"}, format="json")
    assert response.status_code == 201
    data = response.json()
    assert (data["kind"], data["status"], data["body"]) == ("note", "inbox", "Buy milk")
    assert Item.objects.get(id=data["id"]).owner == user


def test_capture_url_creates_inbox_link(api):
    response = api.post(
        "/api/items/capture/", {"text": "https://example.com"}, format="json"
    )
    assert response.status_code == 201
    data = response.json()
    assert (data["kind"], data["status"], data["url"]) == (
        "link",
        "inbox",
        "https://example.com",
    )


@pytest.mark.parametrize("payload", [{}, {"text": ""}, {"text": "   \n "}])
def test_capture_rejects_empty_text(api, payload):
    assert api.post("/api/items/capture/", payload, format="json").status_code == 400


@pytest.mark.django_db
def test_capture_requires_authentication():
    response = APIClient().post("/api/items/capture/", {"text": "x"}, format="json")
    assert response.status_code == 403


def test_items_are_scoped_to_owner(api, user, other_user):
    mine = Item.objects.create(owner=user, kind="note", body="mine")
    theirs = Item.objects.create(owner=other_user, kind="note", body="theirs")

    ids = [item["id"] for item in api.get("/api/items/").json()["results"]]
    assert ids == [str(mine.id)]
    assert api.get(f"/api/items/{theirs.id}/").status_code == 404
    assert api.delete(f"/api/items/{theirs.id}/").status_code == 404


def test_items_filter_by_status_and_collection(api, user):
    work = Collection.objects.create(owner=user, name="Work")
    inbox = Item.objects.create(owner=user, kind="note", body="a")
    organized = Item.objects.create(
        owner=user, kind="note", body="b", status="organized"
    )
    organized.collections.add(work)

    def ids(query):
        return [i["id"] for i in api.get(f"/api/items/?{query}").json()["results"]]

    assert ids("status=inbox") == [str(inbox.id)]
    assert ids(f"collection={work.id}") == [str(organized.id)]
    assert ids("collection=not-a-uuid") == []


def test_items_filter_by_kind_and_text(api, user):
    note = Item.objects.create(owner=user, kind="note", body="Paris trip ideas")
    link = Item.objects.create(
        owner=user, kind="link", url="https://a.io", metadata={"title": "Visit PARIS"}
    )
    upload = Item.objects.create(
        owner=user, kind="file", metadata={"filename": "paris-tickets.pdf"}
    )
    Item.objects.create(owner=user, kind="note", body="Rome")

    def ids(query):
        return {i["id"] for i in api.get(f"/api/items/?{query}").json()["results"]}

    assert ids("q=paris") == {str(note.id), str(link.id), str(upload.id)}
    assert ids("q=paris&kind=link,file") == {str(link.id), str(upload.id)}
    assert ids("kind=note&q=+") == {str(note.id), ids("q=rome").pop()}


def test_items_can_be_updated_and_deleted(api, user):
    item = Item.objects.create(owner=user, kind="note", body="a")
    response = api.patch(
        f"/api/items/{item.id}/", {"status": "archived", "title": "A"}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["status"] == "archived"

    assert api.delete(f"/api/items/{item.id}/").status_code == 204
    assert not Item.objects.exists()


def test_items_cannot_be_created_bypassing_capture(api):
    response = api.post("/api/items/", {"kind": "note", "body": "x"}, format="json")
    assert response.status_code == 405


def test_capture_into_a_collection_organizes_it(api, user):
    collection = Collection.objects.create(owner=user, name="Work")
    response = api.post(
        "/api/items/capture/",
        {"text": "Call Ana", "collection": str(collection.id)},
        format="json",
    )
    assert response.status_code == 201
    data = response.json()
    assert (data["status"], data["collections"]) == ("organized", [str(collection.id)])


def test_capture_into_someone_elses_collection_is_rejected(api, other_user):
    collection = Collection.objects.create(owner=other_user, name="Theirs")
    response = api.post(
        "/api/items/capture/",
        {"text": "x", "collection": str(collection.id)},
        format="json",
    )
    assert response.status_code == 400
    assert not Item.objects.exists()
