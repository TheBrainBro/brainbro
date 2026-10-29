"""
Images in notes. A note's Markdown is never rewritten: each image is found by
its `src` as markdown-it reads it (unescaped and normalized, the same way the
app renders it), and its stored copy is looked up by that key.

- Remote images (`http(s)://…`) are fetched once, in the background, when a
  saved note first links them; removing them from the note deletes the copy.
- Pasted images are uploaded first and linked as `attachments/<id>.<ext>`.
  A note claims them when it saves the link; once no note links them they
  are kept for a while (undo brings the link back), then deleted.
"""

import re
import uuid
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from markdown_it import MarkdownIt
from markdown_it.common.utils import unescapeAll

from .models import NoteImage

# Only the first ones in a note are stored and shown.
MAX_IMAGES = 50
MAX_PASTED_SIZE = 20 * 1024 * 1024
# How long a pasted image no note links to is kept.
UNUSED_GRACE = timedelta(days=7)

# The app's dialect, as far as where images can be: CommonMark plus GFM
# tables and strikethrough. Raw HTML is off, as in the app.
_md = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])

ATTACHMENT = re.compile(
    r"attachments/(?P<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
    r"\.[a-z0-9]{1,5}"
)


def image_sources(body):
    """The `src` of each image in `body`, in order, without repeats."""
    found = {}
    stack = list(reversed(_md.parse(body)))
    while stack:
        token = stack.pop()
        if token.type == "image":
            found.setdefault(token.attrGet("src") or "", None)
        if token.children:
            stack.extend(reversed(token.children))
    found.pop("", None)
    return list(found)


def source_key(destination):
    """A link destination as written (`<a b>`, escapes) as image_sources reports it."""
    if destination.startswith("<") and destination.endswith(">"):
        destination = destination[1:-1]
    return _md.normalizeLink(unescapeAll(destination))


def is_remote(src):
    return src.startswith(("http://", "https://"))


def attachment_id(src):
    if match := ATTACHMENT.fullmatch(src):
        return uuid.UUID(match["id"])
    return None


def sync_note_images(note):
    """
    Brings the note's images in line with its body: copies of removed remote
    images are deleted, new ones added as pending, pasted ones claimed or
    marked unused. True if there are new remote images to fetch.
    """
    sources = image_sources(note.body)[:MAX_IMAGES]
    remote = [src for src in sources if is_remote(src)]
    pasted = {pid for src in sources if (pid := attachment_id(src))}
    images = NoteImage.objects.filter(note=note)
    Source = NoteImage.Source

    # Per object, so the files go too.
    for image in images.filter(source=Source.REMOTE).exclude(src__in=remote):
        image.delete()
    known = set(images.filter(source=Source.REMOTE).values_list("src", flat=True))
    new = [
        NoteImage(owner=note.owner, note=note, source=Source.REMOTE, src=src)
        for src in remote
        if src not in known
    ]
    # Two saves at once may both add the same image: one row wins.
    NoteImage.objects.bulk_create(new, ignore_conflicts=True)

    now = timezone.now()
    # Its own, not yet saved anywhere, or let go by another note (cut and paste).
    NoteImage.objects.filter(
        Q(note=note) | Q(note__isnull=True) | Q(unused_since__isnull=False),
        owner=note.owner,
        source=Source.PASTED,
        id__in=pasted,
    ).update(note=note, unused_since=None, updated_at=now)
    images.filter(source=Source.PASTED, unused_since__isnull=True).exclude(
        id__in=pasted
    ).update(unused_since=now, updated_at=now)
    return bool(new)


def delete_unused_images(now=None):
    """Deletes pasted images no note has linked to for UNUSED_GRACE."""
    cutoff = (now or timezone.now()) - UNUSED_GRACE
    unused = NoteImage.objects.filter(
        source=NoteImage.Source.PASTED, unused_since__lt=cutoff
    )
    count = 0
    for image in unused:
        image.delete()
        count += 1
    return count


IMAGE_DESTINATION = re.compile(
    # `![alt](` then the destination: `<…>` or up to a space or `)`.
    r"(?P<head>!\[(?:[^\]\\\n]|\\.)*\]\(\s*)(?P<dest><[^>\n]*>|[^\s)]+)"
)


def replace_image_sources(body, paths):
    """
    `body` with the inline images whose key is in `paths` pointing there
    instead. For exports only: the note itself is never rewritten.
    """

    def replace(match):
        path = paths.get(source_key(match["dest"]))
        return match["head"] + path if path else match[0]

    return IMAGE_DESTINATION.sub(replace, body)
