import pytest

from apps.boards.layout import empty_layout
from apps.boards.models import Board
from apps.collab.documents import open_document
from apps.history.models import Revision
from apps.history.recording import WINDOW
from apps.items.models import Item
from apps.items.origin import Source, acting


@pytest.fixture
def note(user):
    return Item.objects.create(owner=user, kind=Item.Kind.NOTE, title="Plan", body="v1")


def later(target):
    """What is saved next goes in a revision of its own."""
    latest = target.revisions.order_by("-created_at").first()
    Revision.objects.filter(id=latest.id).update(created_at=latest.created_at - WINDOW)


def edit(item, by="", via=Source.WEB, **fields):
    """An edit, in a revision of its own."""
    later(item)
    with acting(via, by=by):
        for name, value in fields.items():
            setattr(item, name, value)
        if isinstance(item, Item):
            item.mark_edited()
        item.save()


def listed(api, **target):
    query = "&".join(f"{name}={value.id}" for name, value in target.items())
    return api.get(f"/api/revisions/?{query}").json()["results"]


def test_a_notes_history_newest_first_without_its_content(api, note):
    edit(note, body="v2", by="Claude", via=Source.MCP)

    revisions = listed(api, item=note)

    assert [(r["by"], r["via"]) for r in revisions] == [("Claude", "mcp"), ("", "")]
    assert "body" not in revisions[0]


def test_a_revision_with_its_content(api, note):
    [revision] = listed(api, item=note)

    data = api.get(f"/api/revisions/{revision['id']}/").json()

    assert (data["title"], data["body"], data["layout"]) == ("Plan", "v1", None)


def test_the_history_is_of_a_note_or_a_board(api):
    assert api.get("/api/revisions/").status_code == 400
    assert api.get("/api/revisions/?item=nope").json()["results"] == []


def test_restoring_a_note_brings_it_back_as_a_new_revision(api, note):
    edit(note, title="Plan B", body="v2")
    first = listed(api, item=note)[-1]

    response = api.post(f"/api/revisions/{first['id']}/restore/")

    assert response.status_code == 200
    assert (response.json()["title"], response.json()["body"]) == ("Plan", "v1")
    note.refresh_from_db()
    assert (note.title, note.body, note.edited_via) == ("Plan", "v1", Source.WEB)
    revisions = listed(api, item=note)
    # Nothing is lost: v2 is still there, under the restore.
    assert [r["restored_from"] for r in revisions] == [first["id"], None, None]
    assert revisions[0]["restored_from_at"] == first["created_at"]


def test_nothing_goes_into_a_restore_afterwards(api, note):
    edit(note, body="v2")
    first = listed(api, item=note)[-1]
    api.post(f"/api/revisions/{first['id']}/restore/")

    api.patch(f"/api/items/{note.id}/", {"body": "v3"}, format="json")

    bodies = list(note.revisions.values_list("body", flat=True))
    assert bodies == ["v3", "v1", "v2", "v1"]


def test_restoring_reaches_the_note_open_live(
    api, note, relayed, django_capture_on_commit_callbacks
):
    edit(note, body="v2")
    first = listed(api, item=note)[-1]
    # Opened live once: it has a document now.
    open_document(note.id)

    with django_capture_on_commit_callbacks(execute=True):
        api.post(f"/api/revisions/{first['id']}/restore/")

    assert relayed


def item_node(item, node_id):
    return {
        "id": node_id,
        "type": "item",
        "item": str(item.id),
        "x": 10,
        "y": 20,
        "w": None,
        "h": None,
        "parent": None,
    }


def test_restoring_a_board_brings_back_its_title_and_layout(api, user, note):
    other = Item.objects.create(owner=user, kind=Item.Kind.NOTE, body="other")
    board = Board.objects.create(owner=user, title="Ideas")
    edit(board, layout={**empty_layout(), "nodes": [item_node(note, "a")]})
    old = listed(api, board=board)[0]
    later(board)
    api.put(
        f"/api/boards/{board.id}/layout/",
        {
            **empty_layout(),
            "viewport": {"x": 5, "y": 6, "zoom": 2},
            "nodes": [item_node(other, "b")],
        },
        format="json",
        HTTP_IF_MATCH=f'"{board.revision}"',
    )
    api.patch(f"/api/boards/{board.id}/", {"title": "Trip"}, format="json")
    revision = Board.objects.get(id=board.id).revision

    response = api.post(f"/api/revisions/{old['id']}/restore/")

    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Ideas"
    assert [node["id"] for node in data["layout"]["nodes"]] == ["a"]
    # Where the board is looked at from stays.
    assert data["layout"]["viewport"] == {"x": 5, "y": 6, "zoom": 2}
    assert data["revision"] == revision + 1
    assert response["ETag"] == f'"{revision + 1}"'
    # Like any layout save: back on the board, out of the inbox, and off it, back in.
    note.refresh_from_db()
    other.refresh_from_db()
    assert (note.status, other.status) == (Item.Status.ORGANIZED, Item.Status.INBOX)
    assert listed(api, board=board)[0]["restored_from"] == old["id"]


def test_restoring_a_board_drops_items_deleted_since(api, user, note):
    board = Board.objects.create(owner=user, title="Ideas")
    edit(board, layout={**empty_layout(), "nodes": [item_node(note, "a")]})
    old = listed(api, board=board)[0]
    note.delete()

    data = api.post(f"/api/revisions/{old['id']}/restore/").json()

    assert data["layout"]["nodes"] == []


def test_a_board_revision_has_the_items_still_there(api, user, note):
    board = Board.objects.create(owner=user, title="Ideas")
    gone = Item.objects.create(owner=user, kind=Item.Kind.NOTE, body="gone")
    edit(
        board,
        layout={
            **empty_layout(),
            "nodes": [item_node(note, "a"), item_node(gone, "b")],
        },
    )
    gone.delete()
    revision = listed(api, board=board)[0]

    data = api.get(f"/api/revisions/{revision['id']}/").json()

    assert [item["id"] for item in data["items"]] == [str(note.id)]
    assert len(data["layout"]["nodes"]) == 2
