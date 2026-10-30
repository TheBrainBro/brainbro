from apps.boards.canvas import from_canvas, to_canvas
from apps.boards.layout import empty_layout, validate_layout

ITEM = "6b1e0d2c-0000-4000-8000-000000000001"


def layout(**parts):
    return {**empty_layout(), **parts}


def node(id, type="sticky", **fields):
    return {
        "id": id,
        "type": type,
        "x": 0,
        "y": 0,
        "w": None,
        "h": None,
        "parent": None,
        **({"text": "", "color": ""} if type == "sticky" else {}),
        **fields,
    }


def group(id, **fields):
    return {
        "id": id,
        "title": "",
        "color": "",
        "x": 0,
        "y": 0,
        "w": 400,
        "h": 300,
        "parent": None,
        **fields,
    }


def edge(id, source, target, arrow="end", **fields):
    return {
        "id": id,
        "source": source,
        "target": target,
        "label": "",
        "arrow": arrow,
        "stroke": "solid",
        "color": "",
        **fields,
    }


def test_positions_become_absolute_and_groups_go_first():
    board = layout(
        groups=[
            group("inner", x=10, y=20, w=200, h=100, parent="outer", title="In"),
            group("outer", x=100, y=100, w=500, h=500, color="#3b82f6"),
        ],
        nodes=[
            node("a", "item", item=ITEM, x=5.4, y=5.6, parent="inner"),
            node("b", text="Hi", color="#ef4444", w=150, h=90),
        ],
    )

    canvas = to_canvas(board, {ITEM: ("notes/Plan.md", "note")})

    assert canvas["nodes"] == [
        {
            "id": "outer",
            "type": "group",
            "x": 100,
            "y": 100,
            "width": 500,
            "height": 500,
            "color": "#3b82f6",
        },
        {
            "id": "inner",
            "type": "group",
            "x": 110,
            "y": 120,
            "width": 200,
            "height": 100,
            "label": "In",
        },
        {
            "id": "a",
            "x": 115,
            "y": 126,
            "type": "file",
            "file": "notes/Plan.md",
            "width": 280,
            "height": 160,
        },
        {
            "id": "b",
            "x": 0,
            "y": 0,
            "type": "text",
            "text": "Hi",
            "color": "#ef4444",
            "width": 150,
            "height": 90,
        },
    ]


def test_strokes_are_left_out_and_arrows_map_to_ends():
    board = layout(
        nodes=[
            node("a"),
            node("b"),
            node("s", "stroke", points=[[0, 0], [1, 1]], color="", width=2, w=1, h=1),
        ],
        edges=[
            edge("e1", "a", "b", "none", label="x", color="#10b981"),
            edge("e2", "a", "b", "both"),
            edge("e3", "a", "s"),
        ],
    )

    canvas = to_canvas(board, {})

    assert [n["id"] for n in canvas["nodes"]] == ["a", "b"]
    assert canvas["edges"] == [
        {
            "id": "e1",
            "fromNode": "a",
            "fromEnd": "none",
            "toNode": "b",
            "toEnd": "none",
            "label": "x",
            "color": "#10b981",
        },
        {
            "id": "e2",
            "fromNode": "a",
            "fromEnd": "arrow",
            "toNode": "b",
            "toEnd": "arrow",
        },
    ]


def test_an_item_without_a_file_is_a_text_node():
    board = layout(nodes=[node("a", "item", item=ITEM)])

    assert to_canvas(board, {})["nodes"][0]["text"] == "Missing item"


def test_a_canvas_becomes_a_valid_layout_with_nesting():
    canvas = {
        "nodes": [
            {
                "id": "g",
                "type": "group",
                "x": 0,
                "y": 0,
                "width": 1000,
                "height": 1000,
                "label": "All",
            },
            {
                "id": "h",
                "type": "group",
                "x": 100,
                "y": 100,
                "width": 400,
                "height": 400,
                "color": "4",
            },
            {
                "id": "f",
                "type": "file",
                "file": "Plan.md",
                "x": 150,
                "y": 160,
                "width": 250,
                "height": 60,
            },
            {
                "id": "t",
                "type": "text",
                "text": "Note to self",
                "x": 600,
                "y": 50,
                "width": 200,
                "height": 100,
                "color": "#FF0000",
            },
            {
                "id": "u",
                "type": "link",
                "url": "https://example.com",
                "x": -500,
                "y": 0,
                "width": 300,
                "height": 200,
            },
            {"id": "bad", "type": "text", "x": "nope"},
        ],
        "edges": [
            {"id": "e", "fromNode": "f", "toNode": "t", "label": "then"},
            {
                "id": "back",
                "fromNode": "f",
                "toNode": "t",
                "fromEnd": "arrow",
                "toEnd": "none",
            },
            {"id": "gone", "fromNode": "f", "toNode": "bad"},
        ],
    }

    result = from_canvas(canvas, lambda n: ITEM if n.get("file") == "Plan.md" else None)

    assert validate_layout(result) == result
    groups = {g["id"]: g for g in result["groups"]}
    assert groups["g"]["parent"] is None and groups["g"]["title"] == "All"
    assert (groups["h"]["parent"], groups["h"]["color"]) == ("g", "#10b981")
    nodes = {n["id"]: n for n in result["nodes"]}
    assert nodes["f"] == {
        "id": "f",
        "type": "item",
        "item": ITEM,
        "x": 50.0,
        "y": 60.0,
        "w": 250.0,
        "h": None,
        "parent": "h",
    }
    assert (nodes["t"]["type"], nodes["t"]["text"], nodes["t"]["color"]) == (
        "sticky",
        "Note to self",
        "#ff0000",
    )
    assert nodes["t"]["parent"] == "g"
    # A link nobody turned into an item stays as its URL.
    assert nodes["u"]["text"] == "https://example.com"
    assert "bad" not in nodes
    assert [
        (e["id"], e["source"], e["target"], e["arrow"]) for e in result["edges"]
    ] == [
        ("e", "f", "t", "end"),
        ("back", "t", "f", "end"),
    ]


def test_odd_ids_are_cleaned_and_kept_unique():
    canvas = {
        "nodes": [
            {
                "id": "a b",
                "type": "text",
                "text": "1",
                "x": 0,
                "y": 0,
                "width": 10,
                "height": 10,
            },
            {
                "id": "a-b",
                "type": "text",
                "text": "2",
                "x": 0,
                "y": 0,
                "width": 10,
                "height": 10,
            },
        ],
        "edges": [{"id": "é", "fromNode": "a-b", "toNode": "a b"}],
    }

    result = from_canvas(canvas, lambda n: None)

    assert [n["id"] for n in result["nodes"]] == ["a-b", "a-b-2"]
    assert result["edges"][0]["source"] == "a-b-2"
    assert result["edges"][0]["target"] == "a-b"
    assert validate_layout(result) == result


def test_an_item_shows_once_and_junk_reads_as_empty():
    canvas = {
        "nodes": [
            {
                "id": "a",
                "type": "file",
                "file": "x.md",
                "x": 0,
                "y": 0,
                "width": 10,
                "height": 10,
            },
            {
                "id": "b",
                "type": "file",
                "file": "x.md",
                "x": 50,
                "y": 0,
                "width": 10,
                "height": 10,
            },
        ]
    }

    result = from_canvas(canvas, lambda n: ITEM)

    assert [n["type"] for n in result["nodes"]] == ["item", "sticky"]
    assert from_canvas([], lambda n: None)["nodes"] == []
