"""
Boards as JSON Canvas (https://jsoncanvas.org/spec/1.0/), the format of
Obsidian's `.canvas` files, both ways.

JSON Canvas has no nesting: every position is absolute, and a node is in a
group when the group's box holds it. Sizes are required and every number is an
integer. Pen strokes have no counterpart and are left out.
"""

from .layout import (
    MAX_COORDINATE,
    MAX_EDGES,
    MAX_GROUPS,
    MAX_LABEL,
    MAX_NODES,
    MAX_SIZE,
    MAX_STICKY_TEXT,
    SCHEMA_VERSION,
)

# The canvas's own sizes for nodes that take their natural one (as the board
# lays them out before measuring them).
ITEM_WIDTH = {"note": 280, "link": 340, "image": 260, "file": 280, "album": 320}
ITEM_HEIGHT = 160
STICKY_SIZE = 200

# Obsidian's preset colors, mapped to the board's palette.
PRESET_COLORS = {
    "1": "#ef4444",
    "2": "#f97316",
    "3": "#eab308",
    "4": "#10b981",
    "5": "#06b6d4",
    "6": "#8b5cf6",
}

SIDES = {"top", "right", "bottom", "left"}


# Board -> canvas


def to_canvas(layout, files):
    """
    The layout (current schema) as a JSON Canvas document. `files` maps an
    item id to `(path, kind)`, the path being where the item's file is in the
    vault; an item without one shows as a text node saying it's missing.
    """
    groups = {group["id"]: group for group in layout["groups"]}

    def corner(entry):
        x, y = entry["x"], entry["y"]
        parent = entry["parent"]
        while parent is not None:
            x += groups[parent]["x"]
            y += groups[parent]["y"]
            parent = groups[parent]["parent"]
        return {"x": round(x), "y": round(y)}

    # Outer groups first: the first node is drawn at the bottom.
    nodes = [
        _canvas_group(group, corner(group))
        for group in sorted(layout["groups"], key=lambda g: _depth(g, groups))
    ]
    nodes += [
        _canvas_node(entry, corner(entry), files)
        for entry in layout["nodes"]
        if entry["type"] != "stroke"
    ]
    ids = {node["id"] for node in nodes}
    edges = [
        _canvas_edge(edge)
        for edge in layout["edges"]
        if edge["source"] in ids and edge["target"] in ids
    ]
    return {"nodes": nodes, "edges": edges}


def _depth(group, groups):
    depth = 0
    while group["parent"] is not None:
        group = groups[group["parent"]]
        depth += 1
    return depth


def _canvas_group(group, corner):
    node = {
        "id": group["id"],
        "type": "group",
        **corner,
        "width": round(group["w"]),
        "height": round(group["h"]),
    }
    if group["title"]:
        node["label"] = group["title"]
    if group["color"]:
        node["color"] = group["color"]
    return node


def _canvas_node(entry, corner, files):
    node = {"id": entry["id"], **corner}
    if entry["type"] == "sticky":
        node |= {"type": "text", "text": entry["text"]}
        width = height = STICKY_SIZE
        if entry["color"]:
            node["color"] = entry["color"]
    else:
        path, kind = files.get(entry["item"], (None, "note"))
        if path:
            node |= {"type": "file", "file": path}
        else:
            node |= {"type": "text", "text": "Missing item"}
        width, height = ITEM_WIDTH.get(kind, ITEM_WIDTH["note"]), ITEM_HEIGHT
    node["width"] = round(entry["w"] if entry["w"] is not None else width)
    node["height"] = round(entry["h"] if entry["h"] is not None else height)
    return node


def _canvas_edge(edge):
    line = {
        "id": edge["id"],
        "fromNode": edge["source"],
        "fromEnd": "arrow" if edge["arrow"] == "both" else "none",
        "toNode": edge["target"],
        "toEnd": "none" if edge["arrow"] == "none" else "arrow",
    }
    if edge["label"]:
        line["label"] = edge["label"]
    if edge["color"]:
        line["color"] = edge["color"]
    return line


# Canvas -> board


def from_canvas(data, item_for):
    """
    A layout (current schema) from a JSON Canvas document, valid for
    `validate_layout`. `item_for(node)` returns the item id a `file` or `link`
    node stands for, or None to keep it as a sticky note with its path or URL.
    Anything malformed is skipped rather than refused: a canvas made by hand
    should still come in.
    """
    if not isinstance(data, dict):
        data = {}
    raw = data.get("nodes")
    entries = (
        [_box(node) for node in raw if isinstance(node, dict)]
        if isinstance(raw, list)
        else []
    )
    entries = [entry for entry in entries if entry]
    # Board ids are unique across nodes and groups; edges find them by the
    # canvas id (the first node that had it).
    ids = {}
    for entry in entries:
        ids.setdefault(entry["raw"]["id"], entry)
    _dedupe(entries)
    ids = {raw_id: entry["id"] for raw_id, entry in ids.items()}

    group_entries = [e for e in entries if e["type"] == "group"][:MAX_GROUPS]
    node_entries = [e for e in entries if e["type"] != "group"][:MAX_NODES]
    parents = _parents(group_entries, node_entries)

    def relative(entry):
        parent = parents[entry["id"]]
        x, y = entry["x"], entry["y"]
        if parent is not None:
            x -= parent["x"]
            y -= parent["y"]
        return {
            "x": _clamp(x, MAX_COORDINATE),
            "y": _clamp(y, MAX_COORDINATE),
            "parent": parent["id"] if parent is not None else None,
        }

    groups = [
        {
            "id": entry["id"],
            **relative(entry),
            "w": entry["width"],
            "h": entry["height"],
            "title": _text(entry["raw"].get("label"))[:MAX_LABEL],
            "color": _color(entry["raw"].get("color")),
        }
        for entry in group_entries
    ]
    placed = set()
    nodes = [
        {"id": entry["id"], **relative(entry), **_board_node(entry, item_for, placed)}
        for entry in node_entries
    ]
    ends = {entry["id"] for entry in groups + nodes}
    edges = _board_edges(data.get("edges"), ids, ends)
    return {
        "schema_version": SCHEMA_VERSION,
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": nodes,
        "groups": groups,
        "edges": edges,
    }


def _parents(group_entries, node_entries):
    """Each entry's parent group: the smallest one whose box holds it."""

    def parent_of(entry):
        holders = [
            group
            for group in group_entries
            if group["id"] != entry["id"] and _holds(group, entry)
        ]
        if not holders:
            return None
        return min(holders, key=lambda g: g["width"] * g["height"])

    parents = {e["id"]: parent_of(e) for e in group_entries + node_entries}
    # Boxes of the same size hold each other; keep the first, drop the loop.
    for group in group_entries:
        seen = {group["id"]}
        parent = parents[group["id"]]
        while parent is not None:
            if parent["id"] in seen:
                parents[group["id"]] = None
                break
            seen.add(parent["id"])
            parent = parents[parent["id"]]
    return parents


def _board_node(entry, item_for, placed):
    """An item node for what `item_for` knows (once per item), else a sticky."""
    item = item_for(entry["raw"]) if entry["type"] in ("file", "link") else None
    if item and item not in placed:
        placed.add(item)
        return {"type": "item", "item": item, "w": entry["width"], "h": None}
    return {
        "type": "sticky",
        "text": _sticky_text(entry)[:MAX_STICKY_TEXT],
        "color": _color(entry["raw"].get("color")),
        "w": entry["width"],
        "h": entry["height"],
    }


def _board_edges(raw, ids, ends):
    edges = []
    for edge in raw if isinstance(raw, list) else []:
        if not isinstance(edge, dict) or len(edges) >= MAX_EDGES:
            continue
        source, target = ids.get(edge.get("fromNode")), ids.get(edge.get("toNode"))
        edge_id = _id(edge.get("id"))
        if source not in ends or target not in ends or not edge_id:
            continue
        start = edge.get("fromEnd", "none") == "arrow"
        end = edge.get("toEnd", "arrow") == "arrow"
        # The board has no arrow only at the start: the edge turns around.
        if start and not end:
            source, target = target, source
        edges.append(
            {
                "id": edge_id,
                "source": source,
                "target": target,
                "label": _text(edge.get("label"))[:MAX_LABEL],
                "arrow": "both" if start and end else "end" if start or end else "none",
                "stroke": "solid",
                "color": _color(edge.get("color")),
            }
        )
    _dedupe(edges)
    return edges


def _box(node):
    """The node's id, type and box as numbers, or None if they aren't usable."""
    node_type = node.get("type")
    node_id = _id(node.get("id"))
    if node_type not in ("text", "file", "link", "group") or not node_id:
        return None
    numbers = [node.get(key) for key in ("x", "y", "width", "height")]
    if not all(_is_number(n) for n in numbers):
        return None
    x, y, width, height = numbers
    return {
        "id": node_id,
        "type": node_type,
        "x": float(x),
        "y": float(y),
        "width": float(min(max(width, 1), MAX_SIZE)),
        "height": float(min(max(height, 1), MAX_SIZE)),
        "raw": node,
    }


def _holds(group, entry):
    return (
        group["x"] <= entry["x"]
        and group["y"] <= entry["y"]
        and entry["x"] + entry["width"] <= group["x"] + group["width"]
        and entry["y"] + entry["height"] <= group["y"] + group["height"]
    )


def _sticky_text(entry):
    raw = entry["raw"]
    if entry["type"] == "text":
        return _text(raw.get("text"))
    if entry["type"] == "file":
        return _text(raw.get("file"))
    return _text(raw.get("url"))


def _id(value):
    """Canvas ids are free text; the board's are `[A-Za-z0-9_-]{1,64}`."""
    if not isinstance(value, str):
        return None
    cleaned = "".join(
        c if c.isascii() and (c.isalnum() or c in "-_") else "-" for c in value
    )
    return cleaned[:64] or None


def _dedupe(entries):
    seen = set()
    for entry in entries:
        base, number = entry["id"], 2
        while entry["id"] in seen:
            entry["id"] = f"{base[:58]}-{number}"
            number += 1
        seen.add(entry["id"])


def _color(value):
    if not isinstance(value, str):
        return ""
    if value in PRESET_COLORS:
        return PRESET_COLORS[value]
    value = value.lower()
    if (
        len(value) == 7
        and value[0] == "#"
        and all(c in "0123456789abcdef" for c in value[1:])
    ):
        return value
    return ""


def _text(value):
    return value if isinstance(value, str) else ""


def _is_number(value):
    return (
        isinstance(value, int | float)
        and not isinstance(value, bool)
        and value == value
    )


def _clamp(value, limit):
    return float(min(max(value, -limit), limit))
