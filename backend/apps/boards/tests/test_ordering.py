from apps.boards.models import Board


def titles(api):
    return [board["title"] for board in api.get("/api/boards/").json()["results"]]


def move(api, board, after=None):
    return api.post(
        f"/api/boards/{board.id}/move/",
        {"after": str(after.id) if after else None},
        format="json",
    )


def make(user):
    # Created in this order: newest first, so c, b, a.
    return [Board.objects.create(owner=user, title=title) for title in "abc"]


def test_new_boards_land_on_top(api, user):
    make(user)
    api.post("/api/boards/", {"title": "d"}, format="json")
    assert titles(api) == ["d", "c", "b", "a"]


def test_move_boards(api, user):
    a, b, c = make(user)
    assert move(api, c, after=a).status_code == 204
    assert titles(api) == ["b", "a", "c"]
    assert move(api, a).status_code == 204
    assert titles(api) == ["a", "b", "c"]


def test_editing_a_board_keeps_its_place(api, user):
    a, b, c = make(user)
    api.patch(f"/api/boards/{a.id}/", {"title": "z"}, format="json")
    board = Board.objects.get(id=a.id)
    api.put(
        f"/api/boards/{a.id}/layout/",
        board.layout,
        format="json",
        HTTP_IF_MATCH=f'"{board.revision}"',
    )
    assert titles(api) == ["c", "b", "z"]


def test_moving_doesnt_count_as_an_edit(api, user):
    a, b, c = make(user)
    before = Board.objects.get(id=a.id).updated_at
    move(api, a)
    assert Board.objects.get(id=a.id).updated_at == before


def test_move_refuses_other_boards(api, user, other_user):
    a, b, c = make(user)
    theirs = Board.objects.create(owner=other_user, title="theirs")
    assert move(api, a, after=theirs).status_code == 400
    assert move(api, theirs).status_code == 404
