import pytest

from apps.items.models import Item

MARKDOWN = "  indented code\n\n* star bullet\n__bold__\\\nhard break\n\n"


def test_capture_note_kind_keeps_text_as_written(api):
    response = api.post(
        "/api/items/capture/", {"text": MARKDOWN, "kind": "note"}, format="json"
    )
    assert response.status_code == 201
    assert Item.objects.get().body == MARKDOWN


def test_capture_note_kind_does_not_infer_links(api):
    response = api.post(
        "/api/items/capture/",
        {"text": "https://example.com", "kind": "note"},
        format="json",
    )
    data = response.json()
    assert (data["kind"], data["body"], data["preview_status"]) == (
        "note",
        "https://example.com",
        "",
    )


@pytest.mark.parametrize("kind", ["link", "image", "bogus"])
def test_capture_rejects_other_forced_kinds(api, kind):
    response = api.post(
        "/api/items/capture/", {"text": "x", "kind": kind}, format="json"
    )
    assert response.status_code == 400


def test_capture_still_trims_inferred_notes(api):
    api.post("/api/items/capture/", {"text": "  Buy milk \n"}, format="json")
    assert Item.objects.get().body == "Buy milk"


def test_patch_keeps_markdown_byte_for_byte(api, user):
    item = Item.objects.create(owner=user, kind="note", body="a")
    response = api.patch(f"/api/items/{item.id}/", {"body": MARKDOWN}, format="json")
    assert response.status_code == 200
    assert response.json()["body"] == MARKDOWN
    item.refresh_from_db()
    assert item.body == MARKDOWN


def test_patch_allows_emptying_a_note(api, user):
    item = Item.objects.create(owner=user, kind="note", body="a")
    response = api.patch(f"/api/items/{item.id}/", {"body": ""}, format="json")
    assert response.status_code == 200


def test_version_follows_title_and_body_only(user):
    item = Item.objects.create(owner=user, kind="note", body="a")
    before = item.version
    item.status = Item.Status.ARCHIVED
    assert item.version == before
    item.body = "b"
    assert item.version != before
    item.body, item.title = "a", "T"
    assert item.version != before


def test_patch_with_matching_version_saves(api, user):
    item = Item.objects.create(owner=user, kind="note", body="a")
    response = api.patch(
        f"/api/items/{item.id}/",
        {"body": "b"},
        format="json",
        headers={"If-Match": f'"{item.version}"'},
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.body == "b"
    assert response.json()["version"] == item.version


def test_patch_with_stale_version_is_refused_with_current_item(api, user):
    item = Item.objects.create(owner=user, kind="note", body="a")
    stale = item.version
    Item.objects.filter(id=item.id).update(body="from another tab")

    response = api.patch(
        f"/api/items/{item.id}/",
        {"body": "mine"},
        format="json",
        headers={"If-Match": f'"{stale}"'},
    )
    assert response.status_code == 412
    assert response.json()["body"] == "from another tab"
    item.refresh_from_db()
    assert item.body == "from another tab"


def test_triage_does_not_conflict_with_editing(api, user):
    item = Item.objects.create(owner=user, kind="note", body="a")
    version = item.version
    api.post(
        "/api/items/triage/",
        {"ids": [str(item.id)], "action": "archive"},
        format="json",
    )
    response = api.patch(
        f"/api/items/{item.id}/",
        {"body": "b"},
        format="json",
        headers={"If-Match": f'"{version}"'},
    )
    assert response.status_code == 200


def test_if_match_cannot_reach_other_users_items(api, other_user):
    theirs = Item.objects.create(owner=other_user, kind="note", body="x")
    response = api.patch(
        f"/api/items/{theirs.id}/",
        {"body": "y"},
        format="json",
        headers={"If-Match": f'"{theirs.version}"'},
    )
    assert response.status_code == 404


def test_if_match_with_invalid_id_is_not_found(api):
    response = api.patch(
        "/api/items/not-a-uuid/",
        {"body": "y"},
        format="json",
        headers={"If-Match": '"x"'},
    )
    assert response.status_code == 404
