import hashlib
import uuid

from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver

from apps.core.models import OwnedModel

from . import search


class Collection(OwnedModel):
    """
    A named group of items, following PARA: a project (a goal with an end),
    an area (an ongoing responsibility) or a resource (a topic of interest).
    """

    class Kind(models.TextChoices):
        PROJECT = "project", "Project"
        AREA = "area", "Area"
        RESOURCE = "resource", "Resource"

    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=16, choices=Kind, default=Kind.RESOURCE)
    # Hex color (#rrggbb) and an emoji or icon name, both optional.
    color = models.CharField(max_length=7, blank=True)
    icon = models.CharField(max_length=32, blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "name"], name="unique_collection_name_per_owner"
            ),
        ]

    def __str__(self):
        return self.name


def preview_image_path(item, filename):
    # A fresh name per fetch, so a refreshed preview never hits a stale cache.
    return f"previews/{item.id}/{uuid.uuid4().hex}.webp"


def upload_path(item, filename):
    # Random name; the extension comes from the detected type, never the
    # client. The original name lives in metadata["filename"].
    extension = filename.rsplit(".", 1)[-1]
    return f"uploads/{item.id}/{uuid.uuid4().hex}.{extension}"


class ItemManager(models.Manager):
    def get_queryset(self):
        # Only searches read them, and they're as large as the item itself.
        return super().get_queryset().defer("search_text", "search_vector")


class Item(OwnedModel):
    """
    Anything captured: a note, a link, an image or a file, or an album of
    images captured together.

    Everything lands in the inbox; triage moves it to `organized` (it belongs
    somewhere) or `archived` (kept but out of the way).
    """

    class Kind(models.TextChoices):
        NOTE = "note", "Note"
        LINK = "link", "Link"
        IMAGE = "image", "Image"
        FILE = "file", "File"
        ALBUM = "album", "Album"

    class Status(models.TextChoices):
        INBOX = "inbox", "Inbox"
        ORGANIZED = "organized", "Organized"
        ARCHIVED = "archived", "Archived"

    class PreviewStatus(models.TextChoices):
        NONE = "", "None"
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    kind = models.CharField(max_length=8, choices=Kind)
    status = models.CharField(max_length=16, choices=Status, default=Status.INBOX)
    title = models.CharField(max_length=500, blank=True)
    body = models.TextField(blank=True, help_text="Markdown.")
    url = models.URLField(max_length=2048, blank=True)
    # Extracted data: OpenGraph/oEmbed fields for links; filename, MIME type,
    # size (and dimensions for images) for uploads.
    metadata = models.JSONField(default=dict, blank=True)
    preview_status = models.CharField(
        max_length=8, choices=PreviewStatus, default=PreviewStatus.NONE, blank=True
    )
    # Card image: the page's preview for links, a thumbnail for images.
    preview_image = models.ImageField(upload_to=preview_image_path, blank=True)
    # The uploaded original, for image and file items.
    file = models.FileField(upload_to=upload_path, max_length=255, blank=True)
    collections = models.ManyToManyField(Collection, related_name="items", blank=True)
    # Images in an album are items of their own (their files, thumbnails and
    # URLs work as usual) that only show up through it, in `album_position`
    # order. Deleting the album deletes them.
    album = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="album_items",
        limit_choices_to={"kind": "album"},
    )
    album_position = models.PositiveIntegerField(default=0)
    # Kept up to date by Postgres; see `search`.
    search_text = models.GeneratedField(
        expression=search.search_text(),
        output_field=models.TextField(),
        db_persist=True,
    )
    search_vector = models.GeneratedField(
        expression=search.search_vector(),
        output_field=SearchVectorField(),
        db_persist=True,
    )

    objects = ItemManager()

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["owner", "status", "-created_at"]),
            GinIndex(
                fields=["search_text"],
                opclasses=["gin_trgm_ops"],
                name="item_search_text_trgm",
            ),
        ]

    def __str__(self):
        return self.title or self.url or self.body[:60] or str(self.id)

    @property
    def version(self):
        """
        Fingerprint of what the editor edits. Saves send it back (If-Match)
        so one tab can't silently overwrite another; triage doesn't change it.
        """
        content = f"{self.title}\0{self.body}".encode()
        return hashlib.sha256(content).hexdigest()[:16]


@receiver(post_delete, sender=Item)
def delete_item_files(sender, instance, **kwargs):
    if instance.preview_image:
        instance.preview_image.delete(save=False)
    if instance.file:
        instance.file.delete(save=False)


def note_image_path(image, filename):
    # A fresh name per file; the extension comes from what it really is.
    extension = filename.rsplit(".", 1)[-1]
    return f"note-images/{image.id}/{uuid.uuid4().hex}.{extension}"


class NoteImage(OwnedModel):
    """
    An image shown in a note, looked up by its `src` as markdown-it reads it,
    so the note's Markdown is never rewritten.

    Remote images (`![](https://…)`) are a copy fetched once in the
    background: opening the note never tells the site. Pasted images are
    uploads the note links to as `attachments/<id>.<ext>`; they exist before
    the note saves the link, and outlive its removal for a while, so undo
    brings them back.
    """

    class Source(models.TextChoices):
        REMOTE = "remote", "Remote"
        PASTED = "pasted", "Pasted"

    # Null for a pasted image no note has saved yet.
    note = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="note_images",
        limit_choices_to={"kind": "note"},
    )
    source = models.CharField(max_length=8, choices=Source)
    src = models.CharField(max_length=2048)
    status = models.CharField(
        max_length=8,
        choices=Item.PreviewStatus,
        default=Item.PreviewStatus.PENDING,
    )
    # What the app shows: a bounded WebP.
    image = models.ImageField(upload_to=note_image_path, max_length=255, blank=True)
    # Pasted images only: the upload as it came (filename, mime, size,
    # dimensions in metadata).
    original = models.FileField(upload_to=note_image_path, max_length=255, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    # Pasted images: since when no note links to them. Deleted after a while.
    unused_since = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["note", "src"], name="unique_note_image_src"
            ),
        ]
        indexes = [models.Index(fields=["source", "unused_since"])]

    def __str__(self):
        return self.src


@receiver(post_delete, sender=NoteImage)
def delete_note_image_files(sender, instance, **kwargs):
    if instance.image:
        instance.image.delete(save=False)
    if instance.original:
        instance.original.delete(save=False)
