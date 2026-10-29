import math
import uuid

import pytest

from apps.boards.layout import (
    MAX_NODES,
    SCHEMA_VERSION,
    LayoutError,
    empty_layout,
    migrate_layout,
    prune_layout,
    validate_layout,
)

ITEM_A = str(uuid.uuid4())
ITEM_B = str(uuid.uuid4())


def node(node_id="a", item=ITEM_A, **fields):
    return {"id": node_id, "type": "item", "item": item, "x": 0, "y": 0, **fields}


def layout(**fields):
    return {**empty_layout(), **fields}


def error_path(data):
    with pytest.raises(LayoutError) as error:
        validate_layout(data)
    return error.value.path


def test_empty_layout_is_valid():
    assert validate_layout(empty_layout()) == empty_layout() | {
        "viewport": {"x": 0.0, "y": 0.0, "zoom": 1.0}
    }


def test_normalizes_nodes_and_drops_unknown_keys():
    data = layout(nodes=[node(item=ITEM_A.upper(), w=320, extra="x")], extra=1)
    result = validate_layout(data)
    assert "extra" not in result
    assert result["nodes"] == [
        {
            "id": "a",
            "type": "item",
            "item": ITEM_A,
            "x": 0.0,
            "y": 0.0,
            "w": 320.0,
            "h": None,
            "parent": None,
        }
    ]


def test_groups_and_edges_default_to_empty():
    data = {k: v for k, v in empty_layout().items() if k not in ("groups", "edges")}
    result = validate_layout(data)
    assert (result["groups"], result["edges"]) == ([], [])


def test_accepts_groups_with_children_and_edges():
    data = layout(
        groups=[{"id": "g", "x": 0, "y": 0, "w": 400, "h": 300, "title": "Ideas"}],
        nodes=[node("a", parent="g"), node("b", item=ITEM_B)],
        edges=[{"id": "e", "source": "a", "target": "g", "label": "see"}],
    )
    result = validate_layout(data)
    assert result["nodes"][0]["parent"] == "g"
    assert result["groups"][0]["color"] == ""
    assert result["edges"][0]["label"] == "see"


def test_edges_default_to_a_plain_arrow():
    data = layout(
        nodes=[node("a"), node("b", item=ITEM_B)],
        edges=[{"id": "e", "source": "a", "target": "b"}],
    )
    edge = validate_layout(data)["edges"][0]
    assert (edge["arrow"], edge["stroke"], edge["color"]) == ("end", "solid", "")


def test_keeps_edge_looks():
    looks = {"arrow": "both", "stroke": "dashed", "color": "#ef4444"}
    data = layout(
        nodes=[node("a"), node("b", item=ITEM_B)],
        edges=[{"id": "e", "source": "a", "target": "b", **looks}],
    )
    assert validate_layout(data)["edges"][0].items() >= looks.items()


@pytest.mark.parametrize(
    "looks,path",
    [
        ({"arrow": "start"}, "edges[0].arrow"),
        ({"stroke": "dotted"}, "edges[0].stroke"),
        ({"color": "red"}, "edges[0].color"),
    ],
)
def test_rejects_unknown_edge_looks(looks, path):
    data = layout(
        nodes=[node("a"), node("b", item=ITEM_B)],
        edges=[{"id": "e", "source": "a", "target": "b", **looks}],
    )
    assert error_path(data) == path


@pytest.mark.parametrize(
    "data,path",
    [
        ([], ""),
        (layout(schema_version=SCHEMA_VERSION + 1), "schema_version"),
        (layout(viewport={"x": 0, "y": 0, "zoom": 0}), "viewport.zoom"),
        (layout(nodes={}), "nodes"),
        (layout(nodes=[node(type="sticky")]), "nodes[0].type"),
        (layout(nodes=[node(item="nope")]), "nodes[0].item"),
        (layout(nodes=[node(x=math.inf)]), "nodes[0].x"),
        (layout(nodes=[node(x=True)]), "nodes[0].x"),
        (layout(nodes=[node(y="1")]), "nodes[0].y"),
        (layout(nodes=[node(w=0)]), "nodes[0].w"),
        (layout(nodes=[node(id="a b")]), "nodes[0].id"),
        (layout(nodes=[node(parent="g")]), "nodes[0].parent"),
        (layout(nodes=[node("a"), node("a", item=ITEM_B)]), "nodes[1].id"),
        (layout(nodes=[node("a"), node("b")]), "nodes[1].item"),
        (layout(groups=[{"id": "g", "x": 0, "y": 0}]), "groups[0]"),
        (
            layout(
                groups=[{"id": "g", "x": 0, "y": 0, "w": 1, "h": 1, "color": "red"}]
            ),
            "groups[0].color",
        ),
        (layout(edges=[{"id": "e", "source": "a", "target": "b"}]), "edges[0].source"),
    ],
)
def test_rejects_invalid_layouts(data, path):
    assert error_path(data) == path


def test_limits_the_number_of_nodes():
    nodes = [node(str(i), item=str(uuid.uuid4())) for i in range(MAX_NODES + 1)]
    assert error_path(layout(nodes=nodes)) == "nodes"


def test_migrate_keeps_current_layouts():
    assert migrate_layout(empty_layout()) == empty_layout()


def test_migrate_refuses_newer_layouts():
    with pytest.raises(LayoutError):
        migrate_layout(layout(schema_version=SCHEMA_VERSION + 1))


def test_prune_drops_missing_items_and_their_edges():
    data = validate_layout(
        layout(
            nodes=[node("a"), node("b", item=ITEM_B)],
            edges=[{"id": "e", "source": "a", "target": "b"}],
        )
    )
    pruned = prune_layout(data, {ITEM_A})
    assert [n["id"] for n in pruned["nodes"]] == ["a"]
    assert pruned["edges"] == []
    assert prune_layout(data, {ITEM_A, ITEM_B}) is data
