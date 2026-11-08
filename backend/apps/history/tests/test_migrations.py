from datetime import timedelta

from django.utils import timezone


def test_notes_and_boards_start_with_what_they_hold(migrate_to, user):
    # Item columns added since have no database default, and these rows lack them.
    migrate_to(("items", "0020_item_public_listed"))
    old = migrate_to(("history", "0001_initial"))
    Item = old.get_model("items", "Item")
    Board = old.get_model("boards", "Board")
    yesterday = timezone.now() - timedelta(days=1)
    plain = Item.objects.create(owner_id=user.id, kind="note", title="A", body="a")
    edited = Item.objects.create(
        owner_id=user.id,
        kind="note",
        body="b",
        edited_by="Claude",
        edited_via="mcp",
        edited_at=yesterday,
    )
    Item.objects.create(owner_id=user.id, kind="link", url="https://x.org")
    board = Board.objects.create(owner_id=user.id, title="Ideas", layout={"nodes": []})
    Item.objects.filter(id=plain.id).update(updated_at=yesterday)

    new = migrate_to(("history", "0002_first_revisions"))
    Revision = new.get_model("history", "Revision")
    revisions = {
        (r.item_id or r.board_id): r for r in Revision.objects.filter(owner_id=user.id)
    }
    assert set(revisions) == {plain.id, edited.id, board.id}
    first = revisions[plain.id]
    assert (first.title, first.body, first.by, first.created_at) == (
        "A",
        "a",
        "",
        yesterday,
    )
    assert (revisions[edited.id].by, revisions[edited.id].via) == ("Claude", "mcp")
    assert revisions[edited.id].created_at == yesterday
    assert (revisions[board.id].title, revisions[board.id].layout) == (
        "Ideas",
        {"nodes": []},
    )
