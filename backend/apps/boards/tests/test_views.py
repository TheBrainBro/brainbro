import pytest

from apps.boards.layout import empty_layout
from apps.boards.models import Board
from apps.items.models import Collection, Item


@pytest.fixture
def board(user):
    return Board.objects.create(owner=user, title="Ideas")


@pytest.fixture
def note(user):
    return Item.objects.create(owner=user, kind="note", body="Hello")


def node(item, node_id="a", **fields):
    return {
        "id": node_id,
        "type": "item",
        "item": str(item.id),
        "x": 10,
        "y": 20,
        **fields,
    }


def save(api, board, layout, revision=None):
    revision = board.revision if revision is None else revision
    return api.put(
        f"/api/boards/{board.id}/layout/",
        layout,
        format="json",
        HTTP_IF_MATCH=f'"{revision}"',
    )


def test_requires_authentication(client):
    assert client.get("/api/boards/").status_code == 403


def test_create_and_list(api):
    response = api.post("/api/boards/", {"title": "Trip"}, format="json")
    assert response.status_code == 201
    assert response.json()["revision"] == 1
    listed = api.get("/api/boards/").json()["results"]
    assert [(b["title"], b["item_count"]) for b in listed] == [("Trip", 0)]
    assert "layout" not in listed[0]


def test_new_boards_start_empty(api, user):
    response = api.post("/api/boards/", {"title": "Trip"}, format="json")
    board = Board.objects.get(id=response.json()["id"])
    assert board.layout == empty_layout()


def test_only_own_boards(api, other_user):
    theirs = Board.objects.create(owner=other_user, title="Theirs")
    assert api.get("/api/boards/").json()["count"] == 0
    assert api.get(f"/api/boards/{theirs.id}/").status_code == 404
    assert save(api, theirs, empty_layout()).status_code == 404


def test_open_returns_layout_items_and_etag(api, board, note):
    save(api, board, {**empty_layout(), "nodes": [node(note)]})
    response = api.get(f"/api/boards/{board.id}/")
    data = response.json()
    assert response["ETag"] == '"2"'
    assert data["revision"] == 2
    assert [n["item"] for n in data["layout"]["nodes"]] == [str(note.id)]
    assert [i["id"] for i in data["items"]] == [str(note.id)]
    assert data["items"][0]["body"] == "Hello"


def test_rename_does_not_touch_the_layout(api, board):
    response = api.patch(f"/api/boards/{board.id}/", {"title": "New"}, format="json")
    assert response.status_code == 200
    board.refresh_from_db()
    assert (board.title, board.revision) == ("New", 1)


def test_save_bumps_the_revision_and_syncs_items(api, board, note):
    response = save(api, board, {**empty_layout(), "nodes": [node(note, w=300)]})
    assert response.status_code == 200
    assert response.json()["revision"] == 2
    assert response["ETag"] == '"2"'
    board.refresh_from_db()
    assert board.layout["nodes"][0]["w"] == 300.0
    assert list(board.items.all()) == [note]
    assert list(note.boards.all()) == [board]


def test_save_requires_if_match(api, board):
    response = api.put(f"/api/boards/{board.id}/layout/", empty_layout(), format="json")
    assert response.status_code == 428


def test_stale_save_is_refused_with_the_current_board(api, board, note):
    save(api, board, {**empty_layout(), "nodes": [node(note)]})
    response = save(api, board, empty_layout(), revision=1)
    assert response.status_code == 412
    assert response.json()["revision"] == 2
    assert len(response.json()["layout"]["nodes"]) == 1
    board.refresh_from_db()
    assert board.revision == 2


def test_invalid_layout_says_where(api, board, note):
    response = save(api, board, {**empty_layout(), "nodes": [node(note, x="far")]})
    assert response.status_code == 400
    assert response.json()["path"] == "nodes[0].x"


def test_foreign_and_missing_items_are_dropped(api, board, other_user):
    theirs = Item.objects.create(owner=other_user, kind="note", body="secret")
    response = save(api, board, {**empty_layout(), "nodes": [node(theirs)]})
    assert response.json()["layout"]["nodes"] == []
    assert board.items.count() == 0


def test_placing_an_inbox_item_organizes_it(api, board, user, note):
    archived = Item.objects.create(owner=user, kind="note", status="archived")
    save(api, board, {**empty_layout(), "nodes": [node(note), node(archived, "b")]})
    note.refresh_from_db()
    archived.refresh_from_db()
    assert (note.status, archived.status) == ("organized", "archived")


def test_an_item_taken_off_with_nowhere_else_to_be_goes_back_to_the_inbox(
    api, board, note
):
    save(api, board, {**empty_layout(), "nodes": [node(note)]})
    board.refresh_from_db()
    save(api, board, empty_layout())
    note.refresh_from_db()
    assert note.status == "inbox"
    assert board.items.count() == 0


def test_an_item_taken_off_but_still_placed_elsewhere_stays_organized(
    api, user, board, note
):
    other = Board.objects.create(owner=user, title="Other")
    collected = Item.objects.create(owner=user, kind="note", body="Kept")
    collection = Collection.objects.create(owner=user, name="Trip")
    collected.collections.add(collection)
    save(api, board, {**empty_layout(), "nodes": [node(note), node(collected, "b")]})
    save(api, other, {**empty_layout(), "nodes": [node(note)]})
    board.refresh_from_db()
    save(api, board, empty_layout())
    note.refresh_from_db()
    collected.refresh_from_db()
    assert (note.status, collected.status) == ("organized", "organized")


def test_item_already_on_the_board_back_in_the_inbox_stays_there(api, board, note):
    save(api, board, {**empty_layout(), "nodes": [node(note)]})
    Item.objects.filter(id=note.id).update(status="inbox")
    board.refresh_from_db()
    save(api, board, {**empty_layout(), "nodes": [node(note, x=99)]})
    note.refresh_from_db()
    assert note.status == "inbox"


def test_deleted_items_disappear_from_the_layout(api, board, note):
    save(api, board, {**empty_layout(), "nodes": [node(note)]})
    note.delete()
    data = api.get(f"/api/boards/{board.id}/").json()
    assert (data["layout"]["nodes"], data["items"]) == ([], [])


def test_an_item_can_be_on_several_boards(api, user, board, note):
    other = Board.objects.create(owner=user, title="Other")
    save(api, board, {**empty_layout(), "nodes": [node(note)]})
    save(api, other, {**empty_layout(), "nodes": [node(note)]})
    assert set(note.boards.all()) == {board, other}
    counts = {
        b["title"]: b["item_count"] for b in api.get("/api/boards/").json()["results"]
    }
    assert counts == {"Ideas": 1, "Other": 1}


def test_deleting_a_board_keeps_its_items(api, board, note):
    save(api, board, {**empty_layout(), "nodes": [node(note)]})
    assert api.delete(f"/api/boards/{board.id}/").status_code == 204
    assert Item.objects.filter(id=note.id).exists()


def test_deleting_a_board_sends_items_with_nowhere_else_to_be_to_the_inbox(
    api, user, board, note
):
    other = Board.objects.create(owner=user, title="Other")
    elsewhere = Item.objects.create(owner=user, kind="note", body="Also there")
    save(api, board, {**empty_layout(), "nodes": [node(note), node(elsewhere, "b")]})
    save(api, other, {**empty_layout(), "nodes": [node(elsewhere)]})
    api.delete(f"/api/boards/{board.id}/")
    note.refresh_from_db()
    elsewhere.refresh_from_db()
    assert (note.status, elsewhere.status) == ("inbox", "organized")
