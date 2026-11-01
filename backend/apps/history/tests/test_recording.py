from datetime import timedelta

import pytest
from pycrdt import Doc

from apps.boards.layout import empty_layout
from apps.boards.models import Board
from apps.collab.documents import open_document, save_document
from apps.collab.text import rewrite
from apps.history.models import Revision
from apps.history.recording import WINDOW
from apps.items.models import Item
from apps.items.origin import Source, acting

pytestmark = pytest.mark.django_db


def note(owner, body="First", **fields):
    return Item.objects.create(owner=owner, kind=Item.Kind.NOTE, body=body, **fields)


def history(target):
    return list(
        target.revisions.order_by("created_at").values_list("body", "by", "via")
    )


def edit(item, **fields):
    for name, value in fields.items():
        setattr(item, name, value)
    item.mark_edited()
    item.save()


def age(target, by=WINDOW):
    """Its latest revision started `by` ago."""
    latest = target.revisions.order_by("-created_at").first()
    Revision.objects.filter(id=latest.id).update(created_at=latest.created_at - by)


def test_a_new_note_is_its_first_revision(user):
    with acting(Source.MCP, by="Claude"):
        item = note(user, title="Plan")

    [revision] = item.revisions.all()
    assert (revision.title, revision.body) == ("Plan", "First")
    assert (revision.by, revision.via) == ("Claude", Source.MCP)


def test_saves_in_a_row_by_the_same_author_are_one_revision(user):
    item = note(user)
    with acting(Source.WEB):
        edit(item, body="Second")
        edit(item, body="Third")

    assert history(item) == [("First", "", ""), ("Third", "", "web")]


def test_after_a_while_saves_start_a_new_revision(user):
    with acting(Source.WEB):
        item = note(user)
        age(item)
        edit(item, body="Second")

    assert history(item) == [("First", "", "web"), ("Second", "", "web")]


def test_another_author_starts_a_new_revision(user):
    with acting(Source.WEB):
        item = note(user)
    with acting(Source.MCP, by="Claude"):
        edit(item, body="Claude's")
    with acting(Source.WEB):
        edit(item, body="Mine again")

    assert history(item) == [
        ("First", "", "web"),
        ("Claude's", "Claude", "mcp"),
        ("Mine again", "", "web"),
    ]


def test_saves_that_dont_change_the_content_leave_none(user):
    item = note(user)
    item.status = Item.Status.ARCHIVED
    item.save()
    item.preview_status = Item.PreviewStatus.READY
    item.save(update_fields=["preview_status"])

    assert item.revisions.count() == 1


def test_only_notes_have_revisions(user):
    link = Item.objects.create(owner=user, kind=Item.Kind.LINK, url="https://x.org")
    link.title = "Renamed"
    link.save()

    assert not Revision.objects.exists()


def test_live_edits_are_the_users_on_the_web(user):
    item = note(user, body="Plan\n")
    age(item)
    doc = Doc()
    doc.apply_update(open_document(item.id))
    rewrite(doc, "Plan, live\n")
    save_document(item.id, doc.get_update())

    assert history(item)[-1] == ("Plan, live\n", "", "web")


def test_a_deleted_note_takes_its_history_with_it(user):
    item = note(user)
    item.delete()

    assert not Revision.objects.exists()


def layout_with(sticky="Hi", **viewport):
    layout = empty_layout()
    layout["viewport"] = {"x": 0, "y": 0, "zoom": 1, **viewport}
    layout["nodes"] = [
        {
            "id": "s",
            "type": "sticky",
            "text": sticky,
            "color": "",
            "x": 0,
            "y": 0,
            "w": None,
            "h": None,
            "parent": None,
        }
    ]
    return layout


def test_boards_keep_their_title_and_layout(user):
    with acting(Source.WEB):
        board = Board.objects.create(owner=user, title="Ideas")
        age(board)
        board.layout = layout_with("Hi")
        board.save()
    with acting(Source.MCP, by="Claude"):
        board.title = "Trip"
        board.save(update_fields=["title"])

    revisions = list(
        board.revisions.order_by("created_at").values_list("title", "layout", "by")
    )
    assert revisions == [
        ("Ideas", empty_layout(), ""),
        ("Ideas", layout_with("Hi"), ""),
        ("Trip", layout_with("Hi"), "Claude"),
    ]


def test_panning_a_board_is_no_revision(user):
    board = Board.objects.create(owner=user, title="Ideas", layout=layout_with())
    age(board, timedelta(hours=1))
    board.layout = layout_with(x=500, zoom=2)
    board.save()

    assert board.revisions.count() == 1
