"""
The board layout: a JSON document with its own schema, documented in
docs/boards.md.

Layouts are validated on every save and migrated on every read, so the code
only ever sees the current `schema_version`. Adding an optional field or a new
node type is backwards compatible and keeps the version; anything that would
make an old layout read differently bumps it and adds a step to `MIGRATIONS`.
"""

import math
import re
import uuid

SCHEMA_VERSION = 1

MAX_NODES = 2000
MAX_GROUPS = 500
MAX_EDGES = 4000
# Far beyond any real board, close enough to keep numbers sane.
MAX_COORDINATE = 1_000_000
MAX_SIZE = 10_000
MIN_ZOOM, MAX_ZOOM = 0.01, 10
MAX_LABEL = 500

NODE_TYPES = {"item"}
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
COLOR_PATTERN = re.compile(r"^#[0-9a-f]{6}$")

# version -> function that takes a layout of that version to the next one.
MIGRATIONS = {}


class LayoutError(ValueError):
    def __init__(self, path, message):
        super().__init__(f"{path}: {message}" if path else message)
        self.path = path
        self.message = message


def empty_layout():
    return {
        "schema_version": SCHEMA_VERSION,
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [],
        "groups": [],
        "edges": [],
    }


def migrate_layout(layout):
    """Brings a stored layout up to `SCHEMA_VERSION`."""
    version = layout.get("schema_version", 1)
    if version > SCHEMA_VERSION:
        raise LayoutError("schema_version", "This board is from a newer version.")
    while version < SCHEMA_VERSION:
        layout = MIGRATIONS[version](layout)
        version = layout["schema_version"]
    return layout


def prune_layout(layout, item_ids):
    """
    Drops item nodes whose item is gone (deleted, or never the owner's), and
    the edges that pointed at them.
    """
    nodes = [
        node
        for node in layout["nodes"]
        if node["type"] != "item" or node["item"] in item_ids
    ]
    if len(nodes) == len(layout["nodes"]):
        return layout
    ends = {node["id"] for node in nodes} | {group["id"] for group in layout["groups"]}
    edges = [
        edge
        for edge in layout["edges"]
        if edge["source"] in ends and edge["target"] in ends
    ]
    return {**layout, "nodes": nodes, "edges": edges}


def item_ids(layout):
    return {node["item"] for node in layout["nodes"] if node["type"] == "item"}


def validate_layout(data):
    """
    Checks a layout sent by a client and returns it normalized: only known
    keys, numbers as floats, ids lowercased where they are UUIDs. Raises
    `LayoutError` with the path of the first problem.
    """
    _object(data, "")
    if data.get("schema_version") != SCHEMA_VERSION:
        raise LayoutError("schema_version", f"Must be {SCHEMA_VERSION}.")

    viewport = _object(data.get("viewport"), "viewport")
    zoom = _number(viewport.get("zoom"), "viewport.zoom", MIN_ZOOM, MAX_ZOOM)

    groups = [
        _group(group, f"groups[{i}]")
        for i, group in enumerate(_list(data.get("groups", []), "groups", MAX_GROUPS))
    ]
    group_ids = _unique_ids(groups, "groups")

    nodes = [
        _node(node, f"nodes[{i}]", group_ids)
        for i, node in enumerate(_list(data.get("nodes"), "nodes", MAX_NODES))
    ]
    node_ids = _unique_ids(nodes, "nodes")
    if clash := node_ids & group_ids:
        raise LayoutError("nodes", f"Id {sorted(clash)[0]} is also a group.")
    seen = set()
    for i, node in enumerate(nodes):
        if node["type"] == "item":
            if node["item"] in seen:
                raise LayoutError(f"nodes[{i}].item", "This item is already here.")
            seen.add(node["item"])
    for i, group in enumerate(groups):
        if group["parent"] is not None and group["parent"] not in group_ids:
            raise LayoutError(f"groups[{i}].parent", "No such group.")

    ends = node_ids | group_ids
    edges = [
        _edge(edge, f"edges[{i}]", ends)
        for i, edge in enumerate(_list(data.get("edges", []), "edges", MAX_EDGES))
    ]
    _unique_ids(edges, "edges")

    return {
        "schema_version": SCHEMA_VERSION,
        "viewport": {
            "x": _coordinate(viewport.get("x"), "viewport.x"),
            "y": _coordinate(viewport.get("y"), "viewport.y"),
            "zoom": zoom,
        },
        "nodes": nodes,
        "groups": groups,
        "edges": edges,
    }


def _node(data, path, group_ids):
    _object(data, path)
    node_type = data.get("type")
    if node_type not in NODE_TYPES:
        raise LayoutError(f"{path}.type", f"Unknown node type {node_type!r}.")
    parent = data.get("parent")
    if parent is not None and parent not in group_ids:
        raise LayoutError(f"{path}.parent", "No such group.")
    node = {
        "id": _id(data.get("id"), f"{path}.id"),
        "type": node_type,
        **_box(data, path),
        "parent": parent,
    }
    if node_type == "item":
        node["item"] = _uuid(data.get("item"), f"{path}.item")
    return node


def _group(data, path):
    _object(data, path)
    title = data.get("title", "")
    if not isinstance(title, str) or len(title) > MAX_LABEL:
        raise LayoutError(f"{path}.title", f"Text up to {MAX_LABEL} characters.")
    color = data.get("color", "")
    if color and (not isinstance(color, str) or not COLOR_PATTERN.match(color)):
        raise LayoutError(f"{path}.color", "Use a hex color like #3b82f6.")
    group = {
        "id": _id(data.get("id"), f"{path}.id"),
        **_box(data, path),
        "parent": data.get("parent"),
        "title": title,
        "color": color,
    }
    if group["w"] is None or group["h"] is None:
        raise LayoutError(path, "Groups need a width and a height.")
    return group


def _edge(data, path, ends):
    _object(data, path)
    edge = {"id": _id(data.get("id"), f"{path}.id")}
    for end in ("source", "target"):
        if data.get(end) not in ends:
            raise LayoutError(f"{path}.{end}", "No such node or group.")
        edge[end] = data[end]
    label = data.get("label", "")
    if not isinstance(label, str) or len(label) > MAX_LABEL:
        raise LayoutError(f"{path}.label", f"Text up to {MAX_LABEL} characters.")
    edge["label"] = label
    return edge


def _box(data, path):
    """Position (relative to the parent group, if any) and an optional size."""
    box: dict[str, float | None] = {
        "x": _coordinate(data.get("x"), f"{path}.x"),
        "y": _coordinate(data.get("y"), f"{path}.y"),
    }
    for dimension in ("w", "h"):
        value = data.get(dimension)
        box[dimension] = (
            None
            if value is None
            else _number(value, f"{path}.{dimension}", 1, MAX_SIZE)
        )
    return box


def _unique_ids(entries, path):
    ids = set()
    for i, entry in enumerate(entries):
        if entry["id"] in ids:
            raise LayoutError(f"{path}[{i}].id", "Duplicate id.")
        ids.add(entry["id"])
    return ids


def _object(value, path):
    if not isinstance(value, dict):
        raise LayoutError(path, "Must be an object.")
    return value


def _list(value, path, limit):
    if not isinstance(value, list):
        raise LayoutError(path, "Must be a list.")
    if len(value) > limit:
        raise LayoutError(path, f"At most {limit}.")
    return value


def _id(value, path):
    if not isinstance(value, str) or not ID_PATTERN.match(value):
        raise LayoutError(path, "Letters, digits, - and _, up to 64.")
    return value


def _uuid(value, path):
    try:
        return str(uuid.UUID(value))
    except (TypeError, ValueError, AttributeError):
        raise LayoutError(path, "Must be a UUID.") from None


def _coordinate(value, path):
    return _number(value, path, -MAX_COORDINATE, MAX_COORDINATE)


def _number(value, path, low, high):
    # bool is an int in Python; true is not a coordinate.
    if (
        isinstance(value, bool)
        or not isinstance(value, int | float)
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        raise LayoutError(path, f"A number between {low} and {high}.")
    return float(value)
