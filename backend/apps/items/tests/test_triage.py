import pytest

from apps.items.models import Collection, Item


@pytest.fixture
def notes(user):
    return [Item.objects.create(owner=user, kind="note", body=str(i)) for i in range(3)]


def triage(api, **payload):
    return api.post("/api/items/triage/", payload, format="json")


def test_organize_adds_collections_and_leaves_the_inbox(api, user, notes):
    work = Collection.objects.create(owner=user, name="Work")
    reading = Collection.objects.create(owner=user, name="Reading")
    notes[0].collections.add(reading)

    response = triage(
        api,
        ids=[str(notes[0].id), str(notes[1].id)],
        action="organize",
        collections=[str(work.id), str(reading.id)],
    )
    assert response.status_code == 200
    assert {item["status"] for item in response.json()} == {"organized"}
    for note in notes[:2]:
        assert set(note.collections.all()) == {work, reading}
    notes[2].refresh_from_db()
    assert notes[2].status == "inbox"


def test_organize_requires_a_collection(api, notes):
    response = triage(api, ids=[str(notes[0].id)], action="organize")
    assert response.status_code == 400
    assert "collections" in response.json()


@pytest.mark.parametrize("action,status", [("archive", "archived"), ("inbox", "inbox")])
def test_status_actions(api, notes, action, status):
    Item.objects.update(status="organized")
    response = triage(api, ids=[str(n.id) for n in notes], action=action)
    assert response.status_code == 200
    assert set(Item.objects.values_list("status", flat=True)) == {status}


def test_delete(api, notes):
    response = triage(api, ids=[str(notes[0].id), str(notes[1].id)], action="delete")
    assert response.json() == {"deleted": 2}
    assert list(Item.objects.all()) == [notes[2]]


def test_triage_ignores_other_users_items(api, other_user):
    theirs = Item.objects.create(owner=other_user, kind="note", body="x")
    triage(api, ids=[str(theirs.id)], action="delete")
    triage(api, ids=[str(theirs.id)], action="archive")
    theirs.refresh_from_db()
    assert theirs.status == "inbox"


def test_triage_rejects_other_users_collections(api, other_user, notes):
    theirs = Collection.objects.create(owner=other_user, name="Theirs")
    response = triage(
        api, ids=[str(notes[0].id)], action="organize", collections=[str(theirs.id)]
    )
    assert response.status_code == 400


def test_collections_crud_with_item_counts(api, user, other_user, notes):
    Collection.objects.create(owner=other_user, name="Theirs")
    response = api.post(
        "/api/collections/",
        {"name": "Work", "kind": "project", "color": "#3B82F6", "icon": "💼"},
        format="json",
    )
    assert response.status_code == 201
    work_id = response.json()["id"]
    assert response.json()["color"] == "#3b82f6"
    Item.objects.filter(id__in=[notes[0].id, notes[1].id]).update(status="organized")
    Collection.objects.get(id=work_id).items.add(notes[0], notes[1])

    listed = api.get("/api/collections/").json()["results"]
    assert [(c["name"], c["item_count"]) for c in listed] == [("Work", 2)]

    response = api.patch(f"/api/collections/{work_id}/", {"name": "Job"}, format="json")
    assert response.json()["name"] == "Job"

    assert api.delete(f"/api/collections/{work_id}/").status_code == 204
    # Deleting a collection keeps its items.
    assert Item.objects.count() == 3


@pytest.mark.parametrize("action", ["inbox", "archive"])
def test_back_to_inbox_or_archived_leaves_its_collections(api, user, notes, action):
    work = Collection.objects.create(owner=user, name="Work")
    item = notes[0]
    api.post(
        "/api/items/triage/",
        {"ids": [str(item.id)], "action": "organize", "collections": [str(work.id)]},
        format="json",
    )
    api.post(
        "/api/items/triage/", {"ids": [str(item.id)], "action": action}, format="json"
    )

    assert list(item.collections.all()) == []
    assert api.get("/api/items/", {"collection": str(work.id)}).json()["results"] == []
    counts = {
        c["name"]: c["item_count"]
        for c in api.get("/api/collections/").json()["results"]
    }
    assert counts == {"Work": 0}


def test_a_collection_lists_only_what_is_organized_in_it(api, user, notes):
    work = Collection.objects.create(owner=user, name="Work")
    organized, archived = notes[0], notes[1]
    organized.status = "organized"
    organized.save()
    archived.status = "archived"
    archived.save()
    for item in (organized, archived):
        item.collections.add(work)

    listed = api.get("/api/items/", {"collection": str(work.id)}).json()["results"]
    assert [item["id"] for item in listed] == [str(organized.id)]


def test_archive_lists_last_archived_first(api, notes):
    first, second = notes[0], notes[1]
    for item in (first, second):
        api.post(
            "/api/items/triage/",
            {"ids": [str(item.id)], "action": "archive"},
            format="json",
        )
    listed = api.get("/api/items/", {"status": "archived"}).json()["results"]
    assert [item["id"] for item in listed] == [str(second.id), str(first.id)]
