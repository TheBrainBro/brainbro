"""
Importing a BrainBro export (`apps.exports`, format in its README.md), from
its own records instead of the Markdown files:

- `collections.json`: collections with their kind, look and nesting. One
  with the same name at the same level as one the user already has is merged
  into it, which keeps its own look.
- `items.json`: every item with its kind, status, title, body, URL,
  metadata, dates, collections and album, and the files in the export it
  needs (uploads, link previews, note images).
- `boards/<board>.json`: each board's full canvas, pointing at the imported
  items.

Everything keeps its id when no one has it yet; otherwise it gets one made
from the old id and the owner, the same every time. Something whose id the
owner already has is already there (imported before, or never deleted) and
is skipped, so importing the same export twice creates nothing new.

Version history, public pages, tokens and Telegram aren't in an export.
"""

import json
import posixpath
import uuid

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.dateparse import parse_datetime

from apps.boards.layout import (
    COLOR_PATTERN,
    LayoutError,
    item_ids,
    migrate_layout,
    prune_layout,
    validate_layout,
)
from apps.boards.models import Board
from apps.exports.archive import EXPORT_VERSION
from apps.items.models import Collection, CollectionItem, Item, NoteImage
from apps.items.note_images import (
    MAX_PASTED_SIZE,
    attachment_id,
    is_remote,
    replace_image_sources,
    sync_note_images,
)
from apps.items.note_links import sync_note_links
from apps.items.tasks import (
    fetch_link_preview,
    fetch_note_images,
    fetch_note_links,
    generate_thumbnail,
    make_note_image_display,
)
from apps.items.uploads import has_thumbnail

from .vault import (
    MAX_CANVAS_SIZE,
    Importer,
    Vault,
    VaultError,
    VaultImporter,
    import_files,
    inspect,
    open_zip,
)

MANIFEST = "items.json"
COLLECTIONS = "collections.json"
# Every item's text is in it; far beyond a real brain.
MAX_MANIFEST_SIZE = 200 * 1024 * 1024
MAX_PREVIEW_SIZE = 10 * 1024 * 1024

COUNTS = (
    "notes",
    "images",
    "files",
    "links",
    "albums",
    "boards",
    "collections",
    "existing",
    "skipped",
)


class Source:
    OBSIDIAN = "obsidian"
    BRAINBRO = "brainbro"


def import_zip(owner, source):
    """
    Imports the zip `source` for `owner`, all or nothing: a BrainBro export
    from its records, anything else as an Obsidian vault. Returns where it
    came from (`Source`) and counts of what was done.
    """
    with open_zip(source) as archive:
        vault = Vault(archive)
        if is_export(vault):
            return Source.BRAINBRO, import_files(ExportImporter, owner, vault)
        return Source.OBSIDIAN, import_files(VaultImporter, owner, vault)


def source_of(file):
    """What the zip `file` holds, as far as its file names tell."""
    try:
        with open_zip(file) as archive:
            return Source.BRAINBRO if is_export(Vault(archive)) else Source.OBSIDIAN
    except VaultError:
        return Source.OBSIDIAN
    finally:
        file.seek(0)


def is_export(vault):
    return MANIFEST in vault.files and COLLECTIONS in vault.files


class ExportImporter(Importer):
    def __init__(self, owner, vault, stored):
        super().__init__(owner, vault, stored)
        # Old id (as in the export) -> id here, for everything there now.
        self.collections = {}
        self.items = {}
        # (model, id, fields) to set last: saving would touch the dates.
        self.dates = []

    def run(self):
        manifest = self._json(MANIFEST, MAX_MANIFEST_SIZE)
        if not isinstance(manifest, dict) or not isinstance(
            manifest.get("items"), list
        ):
            raise VaultError("This export's items.json can't be read.")
        version = manifest.get("export_version")
        if not isinstance(version, int):
            raise VaultError("This export's items.json can't be read.")
        if version > EXPORT_VERSION:
            raise VaultError(
                "This export is from a newer version of BrainBro. "
                "Update this server and try again."
            )
        collections = self._json(COLLECTIONS, MAX_MANIFEST_SIZE)
        self._import_collections(collections if isinstance(collections, list) else [])

        entries = [
            entry
            for entry in manifest["items"]
            if isinstance(entry, dict) and _uuid(entry.get("id"))
        ]
        # Albums first: their images point at them.
        entries.sort(key=lambda entry: entry.get("kind") != Item.Kind.ALBUM)
        claims = self._claims(Item, [entry["id"] for entry in entries])
        for entry in entries:
            self._import_item(entry, *claims[_uuid(entry["id"])])

        boards = sorted(
            path
            for path in self.vault.files
            if posixpath.dirname(path) == "boards" and path.endswith(".json")
        )
        for path in boards:
            self._import_board(path)

        for model, id, fields in self.dates:
            model.objects.filter(id=id).update(**fields)
        self.schedule()
        return {key: self.counts[key] for key in COUNTS}

    def _json(self, path, limit):
        if path not in self.vault.files or self.vault.size(path) > limit:
            return None
        try:
            return json.loads(self.vault.read(path).decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError):
            return None

    def _file(self, path, limit):
        """The bytes of the export's file at `path`, or None."""
        if not isinstance(path, str) or path not in self.vault.files:
            return None
        if self.vault.size(path) > limit:
            return None
        return self.vault.read(path)

    def _claims(self, model, old_ids):
        """
        Old id -> (id here, whether the owner already has it), for `model`.
        The old id while it's free; else one made from it, the same on every
        import; a random one if even that is someone else's.
        """
        olds = {_uuid(old) for old in old_ids} - {None}
        derived = {old: uuid.uuid5(old, str(self.owner.pk)) for old in olds}
        owners = dict(
            model.objects.filter(id__in=olds | set(derived.values())).values_list(
                "id", "owner_id"
            )
        )
        claims = {}
        for old in olds:
            for candidate in (old, derived[old]):
                if candidate not in owners:
                    claims[old] = (candidate, False)
                    break
                if owners[candidate] == self.owner.pk:
                    claims[old] = (candidate, True)
                    break
            else:
                claims[old] = (uuid.uuid4(), False)
        return claims

    def _restore_dates(self, model, id, entry, *fields):
        values = {}
        for field in fields:
            if when := _date(entry.get(field)):
                values[field] = when
        if model is Item and "created_at" in values:
            # Back in the inbox where it was, among the others.
            values["inbox_rank"] = values["created_at"].timestamp()
        if values:
            self.dates.append((model, id, values))

    # Collections

    def _import_collections(self, entries):
        entries = {
            old: entry
            for entry in entries
            if isinstance(entry, dict) and (old := _uuid(entry.get("id")))
        }
        claims = self._claims(Collection, list(entries))
        visiting = set()

        def place(old):
            """The collection here for an old id, made after its parents."""
            if old in self.collections or old not in entries:
                return self.collections.get(old)
            if old in visiting:  # a loop of parents: this one goes on top
                return None
            visiting.add(old)
            entry = entries[old]
            parent = place(_uuid(entry.get("parent")))
            self.collections[old] = self._import_collection(entry, parent, *claims[old])
            return self.collections[old]

        for old in entries:
            place(old)

    def _import_collection(self, entry, parent, id, exists):
        if exists:
            self.counts["existing"] += 1
            return id
        name = _text(entry.get("name"), 120).strip() or "Untitled"
        same = (
            Collection.objects.filter(
                owner=self.owner, parent_id=parent, name__iexact=name
            )
            .values_list("id", flat=True)
            .first()
        )
        if same:
            return same
        kind = entry.get("kind")
        color = _text(entry.get("color"), 7).lower()
        collection = Collection(
            id=id,
            owner=self.owner,
            name=name,
            kind=kind if kind in Collection.Kind.values else Collection.Kind.RESOURCE,
            color=color if COLOR_PATTERN.fullmatch(color) else "",
            icon=_text(entry.get("icon"), 32),
            parent_id=parent,
            rank=self.rank,
        )
        if data := self._file(entry.get("image"), MAX_PREVIEW_SIZE):
            if self._is_image(data, entry["image"]):
                self.take(len(data))
                collection.image.save("image.webp", ContentFile(data), save=False)
                self.stored.append(collection.image)
        collection.save()
        self._restore_dates(Collection, id, entry, "created_at")
        self.counts["collections"] += 1
        return id

    # Items

    def _import_item(self, entry, id, exists):
        old = _uuid(entry["id"])
        if exists:
            self.items[old] = id
            self.counts["existing"] += 1
            return
        kind = entry.get("kind")
        if kind not in Item.Kind.values:
            self.counts["skipped"] += 1
            return
        status = entry.get("status")
        metadata = entry.get("metadata")
        item = Item(
            id=id,
            owner=self.owner,
            kind=kind,
            status=status if status in Item.Status.values else Item.Status.INBOX,
            title=_text(entry.get("title"), 500),
            body=_text(entry.get("body")),
            metadata=metadata if isinstance(metadata, dict) else {},
        )
        if kind == Item.Kind.LINK:
            if not self._link(item, entry):
                self.counts["skipped"] += 1
                return
        elif kind in (Item.Kind.IMAGE, Item.Kind.FILE, Item.Kind.AUDIO):
            if not self._upload(item, entry):
                self.counts["skipped"] += 1
                return
        item.save()
        self.items[old] = id
        if kind == Item.Kind.NOTE:
            self._note_images(item, entry)
            if sync_note_links(item):
                self.after_commit.append(lambda: fetch_note_links.delay(str(item.id)))
        collections = {
            self.collections[old]
            for old in map(_uuid, _list(entry.get("collections")))
            if old in self.collections
        }
        CollectionItem.objects.bulk_create(
            [CollectionItem(item=item, collection_id=c) for c in collections]
        )
        self._restore_dates(Item, id, entry, "created_at", "updated_at")
        self.counts[_COUNTED.get(item.kind, "files")] += 1

    def _link(self, item, entry):
        url = _text(entry.get("url"), 2048)
        if not url:
            return False
        item.url = url
        preview = self._file(entry.get("preview_path"), MAX_PREVIEW_SIZE)
        if preview and self._is_image(preview, entry["preview_path"]):
            self.take(len(preview))
            item.preview_image.save("preview.webp", ContentFile(preview), save=False)
            self.stored.append(item.preview_image)
            item.preview_status = Item.PreviewStatus.READY
        elif item.metadata:
            item.preview_status = Item.PreviewStatus.READY
        else:  # never fetched there: fetched here
            item.preview_status = Item.PreviewStatus.PENDING
            self.after_commit.append(lambda: fetch_link_preview.delay(str(item.id)))
        return True

    def _upload(self, item, entry):
        """Stores the upload's file; False if it isn't in the export or can't be."""
        data = self._file(entry.get("path"), settings.UPLOAD_MAX_SIZE)
        upload = data and inspect(data, entry["path"])
        if not upload:
            return False
        self.take(len(data))
        # What it really is, as for any upload; its name as it was.
        item.kind = upload.kind
        filename = item.metadata.get("filename") or upload.metadata["filename"]
        item.metadata = {**item.metadata, **upload.metadata, "filename": filename}
        if album := self.items.get(_uuid(entry.get("album"))):
            item.album_id = album
            position = entry.get("album_position")
            item.album_position = position if _is_count(position) else 0
        if has_thumbnail(item):
            item.preview_status = Item.PreviewStatus.PENDING
            self.after_commit.append(lambda: generate_thumbnail.delay(str(item.id)))
        item.file.save(f"upload.{upload.extension}", ContentFile(data), save=False)
        self.stored.append(item.file)
        return True

    def _note_images(self, note, entry):
        """The note's images from the export: pasted ones and copies of web ones."""
        renamed = {}
        seen = set()
        for image in _list(entry.get("images")):
            if not isinstance(image, dict) or not isinstance(image.get("src"), str):
                continue
            src = image["src"]
            if src in seen:
                continue
            seen.add(src)
            data = self._file(image.get("path"), MAX_PASTED_SIZE)
            upload = data and inspect(data, image["path"])
            if not upload or upload.kind != Item.Kind.IMAGE:
                continue
            if is_remote(src):
                self._store_note_image(note, NoteImage.Source.REMOTE, src, data)
            elif pasted := attachment_id(src):
                renamed |= self._paste(note, src, pasted, data, upload)
        if renamed:
            note.body = replace_image_sources(note.body, renamed)
            note.save(update_fields=["body"])
        # Web images it had no copy of are fetched, as for any note.
        if sync_note_images(note):
            self.after_commit.append(lambda: fetch_note_images.delay(str(note.id)))

    def _paste(self, note, src, old, data, upload):
        """A pasted image, under its id if free; {old src: new src} if not."""
        id, exists = self._claims(NoteImage, [old])[old]
        if exists:  # the note's attachment is already here
            return {}
        image = NoteImage(
            id=id,
            owner=self.owner,
            note=note,
            source=NoteImage.Source.PASTED,
            metadata=upload.metadata,
        )
        image.src = f"attachments/{image.id}.{upload.extension}"
        self.take(len(data))
        image.original.save(
            f"original.{upload.extension}", ContentFile(data), save=False
        )
        self.stored.append(image.original)
        image.save()
        self.after_commit.append(lambda: make_note_image_display.delay(str(image.id)))
        return {} if image.src == src else {src: image.src}

    def _store_note_image(self, note, source, src, data):
        self.take(len(data))
        image = NoteImage(
            owner=self.owner,
            note=note,
            source=source,
            src=src,
            status=Item.PreviewStatus.READY,
        )
        image.image.save("image.webp", ContentFile(data), save=False)
        self.stored.append(image.image)
        image.save()

    def _is_image(self, data, path):
        upload = inspect(data, path)
        return upload is not None and upload.kind == Item.Kind.IMAGE

    # Boards

    def _import_board(self, path):
        data = self._json(path, MAX_CANVAS_SIZE)
        old = _uuid(data.get("id")) if isinstance(data, dict) else None
        if old is None or not isinstance(data.get("layout"), dict):
            self.counts["skipped"] += 1
            return
        id, exists = self._claims(Board, [old])[old]
        if exists:
            self.counts["existing"] += 1
            return
        try:
            layout = validate_layout(migrate_layout(data["layout"]))
        except LayoutError:
            self.counts["skipped"] += 1
            return
        # Items that aren't here are left out, with their connections.
        imported = {str(old): str(new) for old, new in self.items.items()}
        layout = prune_layout(layout, set(imported))
        layout["nodes"] = [
            {**node, "item": imported[node["item"]]} if node["type"] == "item" else node
            for node in layout["nodes"]
        ]
        title = _text(data.get("title"), 200).strip()
        board = Board.objects.create(
            id=id,
            owner=self.owner,
            title=title or posixpath.splitext(posixpath.basename(path))[0][:200],
            layout=layout,
            rank=self.rank,
        )
        board.items.set(item_ids(layout))
        self._restore_dates(Board, id, data, "created_at", "updated_at")
        self.counts["boards"] += 1


_COUNTED = {
    Item.Kind.NOTE: "notes",
    Item.Kind.LINK: "links",
    Item.Kind.IMAGE: "images",
    Item.Kind.ALBUM: "albums",
}


def _uuid(value):
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(value) if isinstance(value, str) else None
    except ValueError:
        return None


def _text(value, limit=None):
    if not isinstance(value, str):
        return ""
    return value[:limit] if limit else value


def _list(value):
    return value if isinstance(value, list) else []


def _date(value):
    if not isinstance(value, str):
        return None
    try:
        when = parse_datetime(value)
    except ValueError:
        return None
    return when if when and when.tzinfo else None


def _is_count(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0
