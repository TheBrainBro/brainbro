"""
Putting items on a board from outside the canvas (the MCP server), where the
app would: the closest free spot near the middle of the last view, as
`freeSpot` in frontend/src/boards/layout.ts does.
"""

import uuid

from django.db import transaction
from django.utils import timezone

from apps.items.models import Item

from .canvas import ITEM_HEIGHT, ITEM_WIDTH, STICKY_SIZE
from .layout import MAX_NODES, item_ids, migrate_layout
from .models import Board

GAP = 24
# The view isn't known here: a laptop screen, and a third of the way down,
# where the app pastes when the pointer is off the canvas.
SCREEN_WIDTH, SCREEN_HEIGHT = 1280, 800


class PlacingError(ValueError):
    pass


@transaction.atomic
def add_items(board, items):
    """
    Puts `items` (already the owner's) on `board`, one under the other; the
    ones already there stay where they are. Like saving the layout in the
    app, it bumps the revision and takes new items out of the inbox. Returns
    the ids of the items added.
    """
    board = Board.objects.select_for_update().get(id=board.id)
    layout = migrate_layout(board.layout)
    there = item_ids(layout)
    new = [item for item in items if str(item.id) not in there]
    if len(layout["nodes"]) + len(new) > MAX_NODES:
        raise PlacingError(f"A board holds at most {MAX_NODES} cards.")
    if not new:
        return []

    viewport = layout["viewport"]
    center = {
        "x": (SCREEN_WIDTH / 2 - viewport["x"]) / viewport["zoom"],
        "y": (SCREEN_HEIGHT / 3 - viewport["y"]) / viewport["zoom"],
    }
    taken = obstacles(layout)
    nodes = []
    for index, item in enumerate(new):
        width = ITEM_WIDTH.get(item.kind, ITEM_WIDTH["note"])
        below = {"x": center["x"], "y": center["y"] + index * (ITEM_HEIGHT + GAP)}
        x, y = free_spot(below, width, taken)
        taken.append((x, y, width, ITEM_HEIGHT))
        nodes.append(
            {
                "id": f"n-{uuid.uuid4()}",
                "type": "item",
                "x": round(x, 1),
                "y": round(y, 1),
                "w": float(width),
                "h": None,
                "parent": None,
                "item": str(item.id),
            }
        )

    layout = {**layout, "nodes": [*layout["nodes"], *nodes]}
    added = [item.id for item in new]
    Item.objects.filter(id__in=added, status=Item.Status.INBOX).update(
        status=Item.Status.ORGANIZED, updated_at=timezone.now()
    )
    board.items.add(*added)
    board.layout = layout
    board.revision += 1
    board.save(update_fields=["layout", "revision", "updated_at"])
    return added


def obstacles(layout):
    """Every card's box, `(x, y, width, height)` on the canvas; groups aren't."""
    groups = {group["id"]: group for group in layout["groups"]}
    boxes = []
    for node in layout["nodes"]:
        x, y = node["x"], node["y"]
        parent = node["parent"]
        while parent is not None:
            x += groups[parent]["x"]
            y += groups[parent]["y"]
            parent = groups[parent]["parent"]
        if node["type"] == "sticky":
            natural = STICKY_SIZE, STICKY_SIZE
        else:
            natural = ITEM_WIDTH["note"], ITEM_HEIGHT
        boxes.append((x, y, node["w"] or natural[0], node["h"] or natural[1]))
    return boxes


def free_spot(center, width, boxes):
    """The closest spot near `center` where a card of `width` covers nothing."""
    start_x, start_y = center["x"] - width / 2, center["y"] - ITEM_HEIGHT / 2
    step_x, step_y = width + GAP, ITEM_HEIGHT / 2
    for ring in range(20):
        for dy in range(-ring, ring + 1):
            for dx in range(-ring, ring + 1):
                if max(abs(dx), abs(dy)) != ring:
                    continue
                box = (start_x + dx * step_x, start_y + dy * step_y, width, ITEM_HEIGHT)
                if not any(overlaps(box, other) for other in boxes):
                    return box[0], box[1]
    return start_x, start_y


def overlaps(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return (
        ax < bx + bw + GAP
        and bx < ax + aw + GAP
        and ay < by + bh + GAP
        and by < ay + ah + GAP
    )
