from apps.boards.placing import GAP, free_spot, obstacles, overlaps


def test_an_empty_spot_is_the_center():
    assert free_spot({"x": 0, "y": 0}, 280, []) == (-140, -80)


def test_a_taken_spot_moves_to_the_closest_free_one():
    taken = [(-140, -80, 280, 160)]

    x, y = free_spot({"x": 0, "y": 0}, 280, taken)

    assert not overlaps((x, y, 280, 160), taken[0])
    assert abs(x + 140) <= 280 + GAP


def test_cards_in_groups_count_where_they_are_on_the_canvas():
    layout = {
        "groups": [
            {"id": "outer", "x": 100, "y": 100, "parent": None},
            {"id": "inner", "x": 10, "y": 20, "parent": "outer"},
        ],
        "nodes": [
            {"type": "item", "x": 1, "y": 2, "w": 340, "h": None, "parent": "inner"},
            {"type": "sticky", "x": 0, "y": 0, "w": None, "h": None, "parent": None},
        ],
    }

    assert obstacles(layout) == [(111, 122, 340, 160), (0, 0, 200, 200)]
