"""
Importing an Obsidian vault, uploaded as a zip.

- Folders become collections, nested as they were; what sits in a folder is
  organized into its collection, and what sits at the top of the vault lands
  in the inbox.
- Markdown files become notes named after the file. Images embedded in a
  note (`![[photo.png]]` or `![](photo.png)`) become the note's own images,
  as if pasted into it; everything else (images on their own, PDFs, any other
  file) becomes an image or file item.
- `.canvas` files (JSON Canvas) become boards. Their files are the imported
  items, and their web links become link items.
- Hidden folders (`.obsidian`, `.trash`) are skipped. Wikilinks between notes
  (`[[Other note]]`) are kept as written.
"""

import json
import posixpath
import re
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from urllib.parse import unquote

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from apps.boards.canvas import from_canvas
from apps.boards.layout import LayoutError, item_ids, validate_layout
from apps.boards.models import Board
from apps.items.capture import normalize_url
from apps.items.models import Collection, CollectionItem, Item, NoteImage
from apps.items.note_images import (
    IMAGE_DESTINATION,
    MAX_IMAGES,
    MAX_PASTED_SIZE,
    source_key,
)
from apps.items.note_links import sync_note_links
from apps.items.tasks import (
    fetch_link_preview,
    fetch_note_links,
    generate_thumbnail,
    make_note_image_display,
)
from apps.items.uploads import has_thumbnail, inspect_upload

# Far beyond a real vault; past this the zip is refused.
MAX_FILES = 20_000
MAX_NOTE_SIZE = 1024 * 1024
MAX_CANVAS_SIZE = 5 * 1024 * 1024

# `![[target#heading|alias]]`: the target, and what follows the bar.
WIKI_EMBED = re.compile(
    r"!\[\[(?P<target>[^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|(?P<alias>[^\]\n]*))?\]\]"
)
# `|300` or `|300x200` after an image sets its size, not its text.
IMAGE_SIZE = re.compile(r"^\s*\d+(?:x\d+)?\s*$")
FRONT_MATTER = re.compile(r"\A---\r?\n(?P<yaml>.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)


class VaultError(ValueError):
    """The upload can't be imported at all; the message says why."""


@dataclass
class _Note:
    path: str
    text: str
    # (embed span, vault path, alt text) for each image to make the note's own.
    images: list = field(default_factory=list)


def import_vault(owner, source):
    """
    Imports the vault in the zip `source` (a path or file object) for
    `owner`, all or nothing. Returns counts of what was created.
    """
    try:
        archive = zipfile.ZipFile(source)
    except (zipfile.BadZipFile, OSError):
        raise VaultError("This isn't a zip file.") from None
    with archive:
        vault = _Vault(archive)
        stored = []
        try:
            with transaction.atomic():
                return _Importer(owner, vault, stored).run()
        except BaseException:
            # The rows rolled back; the files they pointed at did not.
            for file in stored:
                file.delete(save=False)
            raise


class _Vault:
    """The vault's files by path, with Obsidian's ways of finding one."""

    def __init__(self, archive):
        self.archive = archive
        entries = [
            info
            for info in archive.infolist()
            if not info.is_dir() and not _hidden(info.filename)
        ]
        if len(entries) > MAX_FILES:
            raise VaultError(f"The vault has more than {MAX_FILES} files.")
        # A vault zipped as its folder: paths start from inside it.
        tops = {info.filename.split("/", 1)[0] for info in entries}
        prefix = ""
        if len(tops) == 1 and all("/" in info.filename for info in entries):
            prefix = tops.pop() + "/"
        self.files = {info.filename[len(prefix) :]: info for info in entries}
        self.lower = {path.lower(): path for path in self.files}
        self.by_name = defaultdict(list)
        # Shortest path first: that's the one a bare name means.
        for path in sorted(self.files, key=lambda p: (p.count("/"), p)):
            self.by_name[posixpath.basename(path).lower()].append(path)

    def read(self, path):
        return self.archive.read(self.files[path])

    def size(self, path):
        return self.files[path].file_size

    def resolve(self, target, folder=""):
        """The vault path `target` points at from a file in `folder`, or None."""
        target = unquote(target).strip().lstrip("/")
        if not target:
            return None
        names = [target] if posixpath.splitext(target)[1] else [target, f"{target}.md"]
        for name in names:
            for candidate in (posixpath.normpath(posixpath.join(folder, name)), name):
                if found := self.lower.get(candidate.lower()):
                    return found
            if matches := self.by_name.get(posixpath.basename(name).lower()):
                return matches[0]
        return None


def _hidden(path):
    return any(part.startswith(".") or part == "__MACOSX" for part in path.split("/"))


class _Importer:
    def __init__(self, owner, vault, stored):
        self.owner = owner
        self.vault = vault
        self.stored = stored
        self.collections = {}
        self.taken_names = set(
            Collection.objects.filter(owner=owner).values_list("name", flat=True)
        )
        self.counts = defaultdict(int)
        # Vault paths of the images stored as some note's own.
        self.attached = set()
        self.after_commit = []

    def run(self):
        notes, canvases = self._read_texts()
        items = {}
        for note in notes:
            items[note.path] = self._create_note(note)
        # Images only notes show belong to them; anything a canvas shows, or
        # no note took, is an item of its own.
        on_canvas = {
            found
            for canvas in canvases.values()
            for node in _file_nodes(canvas)
            if (found := self.vault.resolve(node["file"]))
        }
        for path in self.vault.files:
            if _extension(path) in (".md", ".canvas") or path in items:
                continue
            if path in self.attached and path not in on_canvas:
                continue
            if item := self._create_upload(path):
                items[path] = item
        for path, canvas in canvases.items():
            self._create_board(path, canvas, items)

        for job in self.after_commit:
            transaction.on_commit(job)
        return {key: self.counts[key] for key in COUNTS}

    def _read_texts(self):
        """The vault's notes, and its canvases by path, read and parsed."""
        notes = []
        canvases = {}
        for path in self.vault.files:
            if _extension(path) == ".md":
                if note := self._read_note(path):
                    notes.append(note)
            elif _extension(path) == ".canvas":
                if (canvas := self._read_canvas(path)) is not None:
                    canvases[path] = canvas
        return notes, canvases

    # Collections

    def _collection(self, folder):
        """The collection for a vault folder, made along with its parents."""
        if not folder:
            return None
        if folder in self.collections:
            return self.collections[folder]
        parent = self._collection(posixpath.dirname(folder))
        base = posixpath.basename(folder)[:120]
        name, n = base, 1
        while name in self.taken_names:
            n += 1
            name = f"{base[:115]} {n}"
        self.taken_names.add(name)
        collection = Collection.objects.create(
            owner=self.owner, name=name, parent=parent
        )
        self.collections[folder] = collection
        self.counts["collections"] += 1
        return collection

    def _place(self, item, path):
        """Organized into its folder's collection, or in the inbox at the top."""
        collection = self._collection(posixpath.dirname(path))
        if collection is not None:
            item.status = Item.Status.ORGANIZED
            item.save(update_fields=["status", "updated_at"])
            CollectionItem.objects.create(item=item, collection=collection)

    # Notes

    def _read_note(self, path):
        if self.vault.size(path) > MAX_NOTE_SIZE:
            self.counts["skipped"] += 1
            return None
        text = self.vault.read(path).decode("utf-8-sig", errors="replace")
        text = _front_matter_as_code(text)
        note = _Note(path, text)
        folder = posixpath.dirname(path)
        for match in WIKI_EMBED.finditer(text):
            if (image := self._image(match["target"], folder)) and len(
                note.images
            ) < MAX_IMAGES:
                alias = match["alias"] or ""
                alt = alias if alias and not IMAGE_SIZE.match(alias) else ""
                note.images.append((match.span(), image, alt or _stem(image)))
        for match in IMAGE_DESTINATION.finditer(text):
            target = source_key(match["dest"])
            if "://" in target or target.startswith(("attachments/", "data:")):
                continue
            if (image := self._image(target, folder)) and len(note.images) < MAX_IMAGES:
                note.images.append((match.span("dest"), image, None))
        return note

    def _image(self, target, folder):
        """The vault path of an image a note can show, or None."""
        path = self.vault.resolve(target, folder)
        if not path or self.vault.size(path) > MAX_PASTED_SIZE:
            return None
        if _extension(path) not in IMAGE_EXTENSIONS:
            return None
        return path

    def _create_note(self, note):
        item = Item(owner=self.owner, kind=Item.Kind.NOTE, title=_stem(note.path)[:500])
        item.save()
        self.counts["notes"] += 1
        replacements = []
        attached = {}
        for span, path, alt in note.images:
            if path not in attached:
                attached[path] = self._attach(item, path)
            src = attached[path]
            if src is None:
                continue
            if alt is None:  # a Markdown image: only the destination changes
                replacements.append((span, src))
            else:
                replacements.append((span, f"![{_escape(alt)}]({src})"))
        body = note.text
        for (start, end), text in sorted(replacements, reverse=True):
            body = body[:start] + text + body[end:]
        item.body = body
        item.save(update_fields=["body"])
        if sync_note_links(item):
            self.after_commit.append(lambda: fetch_note_links.delay(str(item.id)))
        self._place(item, note.path)
        return item

    def _attach(self, note, path):
        """Stores the image as one pasted into `note`; its `src`, or None."""
        data = self.vault.read(path)
        upload = _inspect(data, path)
        if upload is None or upload.kind != Item.Kind.IMAGE:
            return None
        image = NoteImage(
            owner=self.owner,
            note=note,
            source=NoteImage.Source.PASTED,
            metadata=upload.metadata,
        )
        image.src = f"attachments/{image.id}.{upload.extension}"
        image.original.save(
            f"original.{upload.extension}", ContentFile(data), save=False
        )
        self.stored.append(image.original)
        image.save()
        self.attached.add(path)
        self.after_commit.append(lambda: make_note_image_display.delay(str(image.id)))
        return image.src

    # Uploads

    def _create_upload(self, path):
        if self.vault.size(path) > settings.UPLOAD_MAX_SIZE:
            self.counts["skipped"] += 1
            return None
        data = self.vault.read(path)
        upload = _inspect(data, path)
        if upload is None:
            self.counts["skipped"] += 1
            return None
        item = Item(
            owner=self.owner,
            kind=upload.kind,
            metadata=upload.metadata,
            title="" if upload.kind == Item.Kind.IMAGE else upload.metadata["filename"],
        )
        if has_thumbnail(item):
            item.preview_status = Item.PreviewStatus.PENDING
            self.after_commit.append(lambda: generate_thumbnail.delay(str(item.id)))
        item.file.save(f"upload.{upload.extension}", ContentFile(data), save=False)
        self.stored.append(item.file)
        item.save()
        self.counts["images" if upload.kind == Item.Kind.IMAGE else "files"] += 1
        self._place(item, path)
        return item

    # Boards

    def _read_canvas(self, path):
        if self.vault.size(path) > MAX_CANVAS_SIZE:
            self.counts["skipped"] += 1
            return None
        try:
            data = json.loads(self.vault.read(path).decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError):
            self.counts["skipped"] += 1
            return None
        if not isinstance(data, dict):
            self.counts["skipped"] += 1
            return None
        return data

    def _create_board(self, path, canvas, items):
        links = {}

        def item_for(node):
            if node.get("type") == "file" and isinstance(node.get("file"), str):
                found = self.vault.resolve(node["file"])
                item = items.get(found) if found else None
                return str(item.id) if item else None
            url = (
                normalize_url(node.get("url") or "")
                if isinstance(node.get("url"), str)
                else None
            )
            if not url:
                return None
            if url not in links:
                links[url] = self._create_link(url, path)
            return str(links[url].id)

        try:
            layout = validate_layout(from_canvas(canvas, item_for))
        except LayoutError:
            self.counts["skipped"] += 1
            return
        board = Board.objects.create(
            owner=self.owner, title=_stem(path)[:200], layout=layout
        )
        placed = item_ids(layout)
        board.items.set(placed)
        # As when placed on a board by hand: they leave the inbox.
        Item.objects.filter(id__in=placed, status=Item.Status.INBOX).update(
            status=Item.Status.ORGANIZED, updated_at=timezone.now()
        )
        self.counts["boards"] += 1

    def _create_link(self, url, canvas_path):
        item = Item.objects.create(
            owner=self.owner,
            kind=Item.Kind.LINK,
            url=url,
            preview_status=Item.PreviewStatus.PENDING,
        )
        self.after_commit.append(lambda: fetch_link_preview.delay(str(item.id)))
        self.counts["links"] += 1
        self._place(item, canvas_path)
        return item


COUNTS = ("notes", "images", "files", "links", "boards", "collections", "skipped")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".heic", ".heif"}


def _extension(path):
    return posixpath.splitext(path)[1].lower()


def _file_nodes(canvas):
    nodes = canvas.get("nodes")
    return [
        node
        for node in (nodes if isinstance(nodes, list) else [])
        if isinstance(node, dict)
        and node.get("type") == "file"
        and isinstance(node.get("file"), str)
    ]


def _inspect(data, path):
    file = ContentFile(data, name=posixpath.basename(path))
    try:
        return inspect_upload(file)
    except ValueError:
        return None


def _front_matter_as_code(text):
    """
    Obsidian's properties as a YAML code block, so they read as such instead
    of a rule and a heading. A Brain export's own front matter is dropped.
    """
    match = FRONT_MATTER.match(text)
    if not match:
        return text
    rest = text[match.end() :].lstrip("\n")
    lines = match["yaml"].splitlines()
    if any(line.startswith("id: ") for line in lines) and any(
        line.startswith("kind: ") for line in lines
    ):
        return rest
    return f"```yaml\n{match['yaml']}\n```\n\n{rest}"


def _stem(path):
    return posixpath.splitext(posixpath.basename(path))[0]


def _escape(text):
    return text.replace("[", r"\[").replace("]", r"\]")
