import pytest

from apps.items import ordering
from apps.items.models import Collection, CollectionItem, Item


def note(owner, body, **fields):
    return Item.objects.create(owner=owner, kind="note", body=body, **fields)


def listed(api, **params):
    results = api.get("/api/items/", params).json()["results"]
    return [item["body"] for item in results]


def move(api, item, after=None, collection=None):
    payload = {"after": str(after.id) if after else None}
    if collection:
        payload["collection"] = str(collection.id)
    return api.post(f"/api/items/{item.id}/move/", payload, format="json")


@pytest.fixture
def inbox(user):
    # Created in this order: newest first, so c, b, a.
    return [note(user, body) for body in "abc"]


def test_inbox_is_newest_first_until_sorted(api, inbox):
    assert listed(api, status="inbox") == ["c", "b", "a"]


def test_move_in_the_inbox(api, inbox):
    a, b, c = inbox
    assert move(api, c, after=a).status_code == 204
    assert listed(api, status="inbox") == ["b", "a", "c"]
    assert move(api, a).status_code == 204
    assert listed(api, status="inbox") == ["a", "b", "c"]
    assert move(api, c, after=a).status_code == 204
    assert listed(api, status="inbox") == ["a", "c", "b"]


def test_new_items_land_on_top_of_a_sorted_inbox(api, inbox):
    a, b, c = inbox
    move(api, a)
    api.post("/api/items/capture/", {"text": "d"}, format="json")
    assert listed(api, status="inbox") == ["d", "a", "c", "b"]


def test_back_to_the_inbox_lands_on_top(api, inbox):
    a, b, c = inbox
    api.post(
        "/api/items/triage/", {"ids": [str(a.id)], "action": "archive"}, format="json"
    )
    api.post(
        "/api/items/triage/", {"ids": [str(a.id)], "action": "inbox"}, format="json"
    )
    assert listed(api, status="inbox") == ["a", "c", "b"]


def test_each_collection_keeps_its_own_order(api, user):
    work = Collection.objects.create(owner=user, name="Work")
    home = Collection.objects.create(owner=user, name="Home")
    a, b = note(user, "a"), note(user, "b")
    for item in (a, b):
        api.post(
            "/api/items/triage/",
            {
                "ids": [str(item.id)],
                "action": "organize",
                "collections": [str(work.id), str(home.id)],
            },
            format="json",
        )
    assert listed(api, collection=str(work.id)) == ["b", "a"]

    assert move(api, b, after=a, collection=work).status_code == 204
    assert listed(api, collection=str(work.id)) == ["a", "b"]
    assert listed(api, collection=str(home.id)) == ["b", "a"]


def test_move_refuses_other_lists(api, user, inbox, other_user):
    a, b, c = inbox
    work = Collection.objects.create(owner=user, name="Work")
    archived = note(user, "x", status=Item.Status.ARCHIVED)
    assert move(api, archived).status_code == 400
    assert move(api, a, collection=work).status_code == 400
    assert move(api, a, after=archived).status_code == 400
    theirs = note(other_user, "theirs")
    assert move(api, theirs).status_code == 404


def test_ranks_too_close_to_split_are_spaced_out(api, inbox, monkeypatch):
    a, b, c = inbox
    Item.objects.filter(id=c.id).update(inbox_rank=10.0)
    Item.objects.filter(id=b.id).update(inbox_rank=10.0 - 1e-9)
    Item.objects.filter(id=a.id).update(inbox_rank=5.0)
    assert move(api, a, after=c).status_code == 204
    assert listed(api, status="inbox") == ["c", "a", "b"]
    ranks = dict(Item.objects.values_list("body", "inbox_rank"))
    assert ranks["c"] - ranks["a"] > ordering.MIN_GAP
    assert ranks["a"] - ranks["b"] > ordering.MIN_GAP


def test_organizing_puts_the_item_on_top_of_the_collection(user):
    work = Collection.objects.create(owner=user, name="Work")
    a, b = note(user, "a"), note(user, "b")
    b.collections.add(work)
    a.collections.add(work)
    ranks = dict(CollectionItem.objects.values_list("item__body", "rank"))
    assert ranks["a"] > ranks["b"]
