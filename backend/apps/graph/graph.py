"""
Everything a user has as a graph: items and collections are the nodes, and
what ties them are the edges.

- `collection`: an item is in a collection.
- `parent`: a collection sits inside another.
- `board`: a line drawn between two items on a board (its label kept).
- `link`: a note links another by its title, as Obsidian does (`[[Title]]`,
  `[[Title|text]]`, `[[Title#heading]]`; embeds `![[…]]` aren't links).

Images in an album are not nodes of their own: the album stands for them.
"""

import re
from collections import defaultdict

from apps.boards.layout import migrate_layout
from apps.boards.models import Board
from apps.items.models import Collection, CollectionItem, Item
from apps.items.titles import note_title

WIKILINK = re.compile(
    r"(?<!!)\[\[(?P<target>[^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]"
)
MAX_LABEL = 120


def build_graph(owner):
    items = list(
        Item.objects.filter(owner=owner, album__isnull=True)
        .only("id", "kind", "status", "title", "body", "url", "metadata")
        .order_by("created_at")
    )
    collections = list(Collection.objects.filter(owner=owner))
    item_ids = {item.id for item in items}
    albums = defaultdict(int)
    for album_id in Item.objects.filter(owner=owner, album__isnull=False).values_list(
        "album_id", flat=True
    ):
        albums[album_id] += 1

    nodes = [
        {
            "id": str(item.id),
            "type": "item",
            "kind": item.kind,
            "status": item.status,
            "label": item_label(item, albums[item.id]),
        }
        for item in items
    ] + [
        {
            "id": str(collection.id),
            "type": "collection",
            "kind": collection.kind,
            "label": collection.name,
            "color": collection.color,
            "icon": collection.icon,
        }
        for collection in collections
    ]

    edges = _Edges()
    for item_id, collection_id in CollectionItem.objects.filter(
        item_id__in=item_ids
    ).values_list("item_id", "collection_id"):
        edges.add(item_id, collection_id, "collection")
    for collection in collections:
        if collection.parent_id:
            edges.add(collection.id, collection.parent_id, "parent")
    _board_edges(owner, item_ids, edges)
    _note_links(items, edges)
    return {"nodes": nodes, "edges": edges.edges}


class _Edges:
    def __init__(self):
        self.edges = []
        self.seen = set()

    def add(self, source, target, kind, label=""):
        source, target = str(source), str(target)
        key = (kind, *sorted((source, target)))
        if source == target or key in self.seen:
            return
        self.seen.add(key)
        edge = {"source": source, "target": target, "type": kind}
        if label:
            edge["label"] = label
        self.edges.append(edge)


def _board_edges(owner, item_ids, edges):
    known = {str(item_id) for item_id in item_ids}
    for layout in Board.objects.filter(owner=owner).values_list("layout", flat=True):
        layout = migrate_layout(layout)
        items = {
            node["id"]: node["item"]
            for node in layout["nodes"]
            if node["type"] == "item" and node["item"] in known
        }
        for edge in layout["edges"]:
            source, target = items.get(edge["source"]), items.get(edge["target"])
            if source and target:
                edges.add(source, target, "board", edge.get("label", ""))


def _note_links(items, edges):
    notes = [item for item in items if item.kind == Item.Kind.NOTE]
    by_title = {}
    for note in notes:
        if note.title:
            by_title.setdefault(note.title.casefold(), note.id)
    for note in notes:
        for match in WIKILINK.finditer(note.body):
            # `Folder/Title.md` and `Title` both mean the note titled Title.
            target = match["target"].strip().rsplit("/", 1)[-1].removesuffix(".md")
            if found := by_title.get(target.casefold()):
                edges.add(note.id, found, "link")


def item_label(item, album_size=0):
    """A one-line name, as the app's lists show it (`itemLabel` in the frontend)."""
    if item.title:
        return item.title[:MAX_LABEL]
    caption = (
        item.body.strip() if item.kind in (Item.Kind.IMAGE, Item.Kind.ALBUM) else ""
    )
    if caption:
        return caption.splitlines()[0].strip()[:MAX_LABEL]
    if item.kind == Item.Kind.LINK:
        return (item.metadata.get("title") or item.url)[:MAX_LABEL]
    if item.kind == Item.Kind.NOTE:
        return note_title(item.body, fallback="Empty note")
    if item.kind == Item.Kind.ALBUM:
        return f"{album_size} images"
    fallback = "Image" if item.kind == Item.Kind.IMAGE else "File"
    return (item.metadata.get("filename") or fallback)[:MAX_LABEL]
