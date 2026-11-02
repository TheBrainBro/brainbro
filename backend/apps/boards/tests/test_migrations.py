from datetime import timedelta

from django.utils import timezone


def test_board_ranks_keep_the_last_edited_first_order(migrate_to, user):
    old = migrate_to(("boards", "0001_initial"))
    Board = old.get_model("boards", "Board")
    now = timezone.now()
    for title, days in (("old", 3), ("recent", 1), ("middle", 2)):
        board = Board.objects.create(owner_id=user.id, title=title)
        Board.objects.filter(id=board.id).update(updated_at=now - timedelta(days=days))

    new = migrate_to(("boards", "0002_board_rank"))
    Board = new.get_model("boards", "Board")
    titles = list(Board.objects.order_by("-rank").values_list("title", flat=True))
    assert titles == ["recent", "middle", "old"]
