"""
The full export: everything a user has, as a zip that makes sense without the
app. The format is documented in README.md, which ships inside every export.
"""

import json
import shutil
import zipfile
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote, urlsplit

from django.utils import timezone

from apps.boards.layout import migrate_layout, prune_layout
from apps.boards.models import Board
from apps.items.models import Collection, Item

from .names import Folder, clean

EXPORT_VERSION = 1
README = Path(__file__).with_name("README.md")

# Already compressed, or not worth it: stored as they are.
COMPRESSIBLE_TYPES = {"application/json", "application/xml", "image/svg+xml"}
COPY_CHUNK = 1024 * 1024
# A deflated stream can't tell its size up front; past this it needs ZIP64.
ZIP64_LIMIT = 2**31 - 1


def write_export(owner, target, now=None):
    """Writes everything `owner` has as a zip at `target` (a path)."""
    now = now or timezone.now()
    root = f"brain-export-{timezone.localdate(now).isoformat()}/"
    items = list(
        Item.objects.filter(owner=owner)
        .prefetch_related("collections")
        .order_by("created_at", "id")
    )
    collections = list(Collection.objects.filter(owner=owner).order_by("name"))
    boards = list(Board.objects.filter(owner=owner).order_by("created_at", "id"))
    places = _place(items)

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        writer = _Writer(archive, root, now)
        writer.text("README.md", README.read_text())
        missing = set()
        for item in items:
            if not _write_item(writer, item, places):
                missing.add(item.id)
        writer.json("collections.json", _collections(collections, items))
        _write_boards(writer, boards, items, places)
        writer.json("items.json", _manifest(items, places, missing, now))


class _Writer:
    def __init__(self, archive, root, now):
        self.archive = archive
        self.root = root
        self.now = now

    def _info(self, path, when, compress):
        info = zipfile.ZipInfo(
            self.root + path, date_time=timezone.localtime(when).timetuple()[:6]
        )
        info.compress_type = zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED
        return info

    def text(self, path, content, when=None):
        info = self._info(path, when or self.now, compress=True)
        self.archive.writestr(info, content.encode())

    def json(self, path, data, when=None):
        self.text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n", when)

    def copy(self, path, field, mime, when):
        """Copies a stored file in; False if it's gone from the disk."""
        compress = mime.startswith("text/") or mime in COMPRESSIBLE_TYPES
        info = self._info(path, when, compress)
        try:
            source = field.open("rb")
        except FileNotFoundError:
            return False
        with (
            source,
            self.archive.open(
                info, "w", force_zip64=field.size > ZIP64_LIMIT
            ) as target,
        ):
            shutil.copyfileobj(source, target, COPY_CHUNK)
        return True


# Where each item goes


class _Place:
    def __init__(self, path, name, preview=None):
        self.path = path  # relative to the export's root
        self.name = name  # how it's called in outlines
        self.preview = preview


def _place(items):
    folders = defaultdict(Folder)
    places = _place_albums(items, folders)
    for item in items:
        if item.id not in places and (place := _place_item(item, folders)):
            places[item.id] = place
    return places


def _place_albums(items, folders):
    """Each album is a folder with its images, numbered in order."""
    places = {}
    images = defaultdict(list)
    for item in items:
        if item.kind == Item.Kind.ALBUM:
            folder = f"albums/{folders['albums'].name(clean(item.title))}"
            places[item.id] = _Place(f"{folder}/album.md", folder.split("/")[1])
        elif item.album_id and item.file:
            images[item.album_id].append(item)
    for album_id, album_images in images.items():
        album_images.sort(key=lambda image: image.album_position)
        width = max(2, len(str(len(album_images))))
        folder = places[album_id].path.rsplit("/", 1)[0]
        for position, image in enumerate(album_images, 1):
            stem, extension = _upload_name(image)
            name = folders[folder].name(f"{position:0{width}} {stem}", extension)
            places[image.id] = _Place(f"{folder}/{name}", stem)
    return places


def _place_item(item, folders):
    if item.kind == Item.Kind.NOTE:
        stem = clean(item.title or _first_line(item.body))
        name = folders["notes"].name(stem, "md")
        return _Place(f"notes/{name}", name[:-3])
    if item.kind == Item.Kind.LINK:
        stem = folders["links"].name(clean(_link_title(item)))
        preview = f"links/previews/{stem}.webp" if item.preview_image else None
        return _Place(f"links/{stem}.md", stem, preview)
    if item.file and not item.album_id:
        folder = "images" if item.kind == Item.Kind.IMAGE else "files"
        stem, extension = _upload_name(item)
        return _Place(f"{folder}/{folders[folder].name(stem, extension)}", stem)
    return None


def _first_line(body):
    for line in body.splitlines():
        line = line.strip().lstrip("#>*-+ ").removeprefix("[ ] ").strip()
        if line:
            return line
    return ""


def _link_title(item):
    return (
        item.title
        or item.metadata.get("title")
        or (urlsplit(item.url).hostname or "").removeprefix("www.")
    )


def _upload_name(item):
    """The title (or the original name) and the extension of the stored file."""
    extension = (
        item.file.name.rsplit(".", 1)[-1].lower() if "." in item.file.name else ""
    )
    stem = item.title
    if not stem:
        filename = item.metadata.get("filename", "")
        stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    elif extension and stem.lower().endswith(f".{extension}"):
        stem = stem[: -len(extension) - 1]
    return clean(stem), extension


# Items


def _write_item(writer, item, places):
    """Writes the item's files; False if its upload is missing from the disk."""
    place = places.get(item.id)
    if place is None:
        return not item.file
    if item.kind == Item.Kind.NOTE:
        body = (
            item.body if item.body.endswith("\n") or not item.body else f"{item.body}\n"
        )
        writer.text(place.path, _front_matter(item) + body, item.updated_at)
    elif item.kind == Item.Kind.LINK:
        if place.preview and not writer.copy(
            place.preview, item.preview_image, "image/webp", item.updated_at
        ):
            place.preview = None
        writer.text(place.path, _link_markdown(item, place), item.updated_at)
    elif item.kind == Item.Kind.ALBUM:
        writer.text(place.path, _album_markdown(item, places), item.updated_at)
    else:
        mime = item.metadata.get("mime", "")
        return writer.copy(place.path, item.file, mime, item.updated_at)
    return True


def _front_matter(item, **extra):
    """YAML front matter. Strings go out as JSON strings, which YAML reads as is."""
    fields = {
        "id": str(item.id),
        "kind": item.kind,
        "status": item.status,
        "title": item.title,
        **extra,
        "collections": [collection.name for collection in item.collections.all()],
        "created": item.created_at,
        "updated": item.updated_at,
    }
    lines = ["---"]
    for key, value in fields.items():
        if value == "":
            continue
        if hasattr(value, "isoformat"):
            value = value.isoformat()
        else:
            value = json.dumps(value, ensure_ascii=False)
        lines.append(f"{key}: {value}")
    lines.append("---\n\n")
    return "\n".join(lines)


def _link_markdown(item, place):
    metadata = item.metadata
    parts = [f"[{_escape(_link_title(item) or item.url)}]({_url(item.url)})"]
    if place.preview:
        parts.append(f"![]({_href(place.preview, 'links/')})")
    if description := metadata.get("description"):
        parts.append("\n".join(f"> {line}" for line in description.splitlines()))
    if item.body:
        parts.append(item.body)
    matter = _front_matter(
        item,
        url=item.url,
        site=metadata.get("site_name", ""),
        author=metadata.get("author", ""),
    )
    return matter + "\n\n".join(parts) + "\n"


def _album_markdown(item, places):
    directory = places[item.id].path.rsplit("/", 1)[0] + "/"
    images = sorted(item.album_items.all(), key=lambda image: image.album_position)
    parts = [item.body] if item.body else []
    for image in images:
        if place := places.get(image.id):
            parts.append(f"![{_escape(place.name)}]({_href(place.path, directory)})")
    return _front_matter(item) + "\n\n".join(parts) + "\n"


def _escape(text):
    return text.replace("[", r"\[").replace("]", r"\]")


def _href(path, base):
    """Link target for `path` from a file in the folder `base` (both from the root)."""
    if path.startswith(base):
        return quote(path[len(base) :])
    return quote("../" * base.count("/") + path)


def _url(url):
    # Spaces or parentheses would end a plain link target early.
    return f"<{url}>" if any(c in url for c in " ()") else url


def _manifest(items, places, missing, now):
    entries = []
    for item in items:
        place = places.get(item.id)
        entry = {
            "id": str(item.id),
            "kind": item.kind,
            "status": item.status,
            "title": item.title,
            "body": item.body,
            "url": item.url,
            "metadata": item.metadata,
            "collections": [
                str(collection.id) for collection in item.collections.all()
            ],
            "album": str(item.album_id) if item.album_id else None,
            "created_at": item.created_at.isoformat(),
            "updated_at": item.updated_at.isoformat(),
            "path": place.path if place and item.id not in missing else None,
        }
        if item.album_id:
            entry["album_position"] = item.album_position
        if place and place.preview:
            entry["preview_path"] = place.preview
        entries.append(entry)
    return {
        "export_version": EXPORT_VERSION,
        "exported_at": now.isoformat(),
        "items": entries,
    }


def _collections(collections, items):
    members = defaultdict(list)
    for item in items:
        for collection in item.collections.all():
            members[collection.id].append(str(item.id))
    return [
        {
            "id": str(collection.id),
            "name": collection.name,
            "kind": collection.kind,
            "color": collection.color,
            "icon": collection.icon,
            "created_at": collection.created_at.isoformat(),
            "items": members[collection.id],
        }
        for collection in collections
    ]


# Boards


def _write_boards(writer, boards, items, places):
    by_id = {str(item.id): item for item in items}
    folder = Folder()
    for board in boards:
        stem = folder.name(clean(board.title))
        layout = prune_layout(migrate_layout(board.layout), set(by_id))
        referenced = {
            node["item"]: {
                "kind": by_id[node["item"]].kind,
                "title": _item_name(by_id[node["item"]], places),
                "path": _path(by_id[node["item"]], places),
            }
            for node in layout["nodes"]
            if node["type"] == "item"
        }
        writer.json(
            f"boards/{stem}.json",
            {
                "id": str(board.id),
                "title": board.title,
                "created_at": board.created_at.isoformat(),
                "updated_at": board.updated_at.isoformat(),
                "layout": layout,
                "items": referenced,
            },
            board.updated_at,
        )
        writer.text(
            f"boards/{stem}.md",
            _board_outline(board, stem, layout, referenced),
            board.updated_at,
        )


def _item_name(item, places):
    place = places.get(item.id)
    return item.title or (place.name if place else "") or "Untitled"


def _path(item, places):
    place = places.get(item.id)
    return place.path if place else None


def _board_outline(board, stem, layout, referenced):
    """The board as text: frames as headings, what's in them as lists."""

    def position(entry):
        return (entry["y"], entry["x"])

    nodes = sorted(
        (node for node in layout["nodes"] if node["type"] != "stroke"), key=position
    )
    groups = sorted(layout["groups"], key=position)
    labels = {node["id"]: _node_label(node, referenced) for node in nodes}
    labels |= {group["id"]: group["title"] or "Untitled frame" for group in groups}

    lines = [f"# {board.title}", ""]

    def section(parent, depth):
        entries = [
            _node_line(node, referenced) for node in nodes if node["parent"] == parent
        ]
        if entries:
            lines.extend([*entries, ""])
        for group in groups:
            if group["parent"] == parent:
                lines.extend([f"{'#' * min(6, depth)} {labels[group['id']]}", ""])
                section(group["id"], depth + 1)

    section(None, 2)

    if layout["edges"]:
        lines.extend(["## Connections", ""])
        for edge in layout["edges"]:
            arrow = {"end": "→", "none": "-", "both": "↔"}[edge["arrow"]]
            source, target = (
                labels.get(edge[end], "?") for end in ("source", "target")
            )
            line = f"- {source} {arrow} {target}"
            if edge["label"]:
                line += f": {edge['label']}"
            lines.append(line)
        lines.append("")

    if strokes := sum(1 for node in layout["nodes"] if node["type"] == "stroke"):
        drawings = "drawing is" if strokes == 1 else "drawings are"
        lines.extend([f"_{strokes} pen {drawings} only in {stem}.json._", ""])

    matter = "\n".join(
        [
            "---",
            f"id: {json.dumps(str(board.id))}",
            f"title: {json.dumps(board.title, ensure_ascii=False)}",
            f"created: {board.created_at.isoformat()}",
            f"updated: {board.updated_at.isoformat()}",
            "---",
            "",
            "",
        ]
    )
    return matter + "\n".join(lines)


def _node_label(node, referenced):
    if node["type"] == "item":
        return referenced[node["item"]]["title"]
    return " ".join(node["text"].split()) or "Sticky note"


def _node_line(node, referenced):
    if node["type"] == "sticky":
        return f"- Sticky note: {_node_label(node, referenced)}"
    entry = referenced[node["item"]]
    if entry["path"] is None:
        return f"- {_escape(entry['title'])}"
    return f"- [{_escape(entry['title'])}]({_href(entry['path'], 'boards/')})"
