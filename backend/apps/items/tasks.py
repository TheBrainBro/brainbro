import logging

from celery import shared_task
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from apps.events.changes import changed

from .embeddings import embed_stale
from .models import (
    Item,
    NoteImage,
    NoteLink,
    note_image_path,
    note_link_image_path,
    preview_image_path,
)
from .note_images import delete_unused_images
from .previews import build_preview, download_preview_image, reencode_image
from .safe_http import FetchError, TransientFetchError
from .uploads import IMAGE_FORMATS, MAX_IMAGE_PIXELS, has_thumbnail, make_thumbnail

logger = logging.getLogger(__name__)

RETRY_DELAYS = [30, 120, 600]  # seconds; exponential-ish backoff


@shared_task(bind=True, max_retries=len(RETRY_DELAYS))
def fetch_link_preview(self, item_id):
    """
    Fetch the preview of a link item and store it, image included.

    Writes go through queryset updates so edits the user makes while the
    fetch runs (title, status, collections) are never overwritten.
    """
    item = Item.objects.filter(id=item_id, kind=Item.Kind.LINK).first()
    if item is None:
        return

    try:
        preview = build_preview(item.url)
    except TransientFetchError as exc:
        _retry_if_possible(self, exc)
        return _mark_failed(item, exc)
    except FetchError as exc:
        return _mark_failed(item, exc)

    image = None
    if preview.image_url:
        try:
            image = download_preview_image(preview.image_url)
        except TransientFetchError as exc:
            # Worth another try; on the last attempt keep the preview anyway.
            _retry_if_possible(self, exc)
            logger.info("Preview image unavailable for %s: %s", item.url, exc)

    _store_preview(item, preview, image)


def _retry_if_possible(task, exc):
    if task.request.retries < task.max_retries:
        raise task.retry(exc=exc, countdown=RETRY_DELAYS[task.request.retries])


def _store_preview(item, preview, image):
    image_name = ""
    if image:
        image_name = default_storage.save(
            preview_image_path(item, ""), ContentFile(image)
        )

    items = Item.objects.filter(id=item.id)
    updated = items.update(
        metadata=preview.metadata,
        preview_status=Item.PreviewStatus.READY,
        preview_image=image_name,
    )
    if not updated:  # deleted meanwhile
        if image_name:
            default_storage.delete(image_name)
        return
    if item.preview_image and item.preview_image.name != image_name:
        default_storage.delete(item.preview_image.name)
    if title := preview.metadata.get("title"):
        items.filter(title="").update(title=title[:500])
    changed(item.owner_id, items=[item.id])


def _mark_failed(item, exc):
    logger.info("Link preview failed for %s: %s", item.url, exc)
    Item.objects.filter(id=item.id).update(
        preview_status=Item.PreviewStatus.FAILED,
        metadata={**item.metadata, "preview_error": str(exc)[:500]},
    )
    changed(item.owner_id, items=[item.id])


@shared_task
def generate_thumbnail(item_id):
    """
    Make the card image of an upload (a bounded WebP): the image itself
    re-encoded, or the first page of a PDF.
    """
    item = Item.objects.filter(id=item_id).first()
    if item is None or not item.file or not has_thumbnail(item):
        return

    thumbnail = make_thumbnail(item)
    if thumbnail is None:
        logger.info("Could not make a thumbnail for item %s", item.id)
        Item.objects.filter(id=item.id).update(preview_status=Item.PreviewStatus.FAILED)
        changed(item.owner_id, items=[item.id])
        return

    name = default_storage.save(preview_image_path(item, ""), ContentFile(thumbnail))
    updated = Item.objects.filter(id=item.id).update(
        preview_status=Item.PreviewStatus.READY, preview_image=name
    )
    if not updated:  # deleted meanwhile
        default_storage.delete(name)
    elif item.preview_image and item.preview_image.name != name:
        default_storage.delete(item.preview_image.name)
    changed(item.owner_id, items=[item.id])


@shared_task(bind=True, max_retries=len(RETRY_DELAYS))
def fetch_note_images(self, note_id):
    """
    Fetch a copy of each pending remote image of a note, re-encoded like
    link previews. Images that can't be fetched for good are marked failed;
    temporary errors retry the ones still pending.
    """
    pending = NoteImage.objects.filter(
        note_id=note_id,
        source=NoteImage.Source.REMOTE,
        status=Item.PreviewStatus.PENDING,
    )
    unavailable = None
    for image in pending:
        try:
            data = download_preview_image(image.src)
        except TransientFetchError as exc:
            unavailable = exc
            continue
        if data is None:
            _note_image_failed(image)
        else:
            _store_note_image(image, data)
    if unavailable:
        _retry_if_possible(self, unavailable)
        for image in pending.all():
            logger.info("Note image unavailable: %s: %s", image.src, unavailable)
            _note_image_failed(image)


@shared_task
def make_note_image_display(image_id):
    """The WebP the app shows for a pasted image, made from its original."""
    image = NoteImage.objects.filter(id=image_id).first()
    if image is None or not image.original:
        return
    with image.original.open("rb") as source:
        data = reencode_image(source, IMAGE_FORMATS, MAX_IMAGE_PIXELS)
    if data is None:
        logger.info("Could not read pasted image %s", image.id)
        return _note_image_failed(image)
    _store_note_image(image, data)


@shared_task
def embed_items():
    return embed_stale()


@shared_task
def delete_unused_note_images():
    return delete_unused_images()


def _store_note_image(image, data):
    name = default_storage.save(note_image_path(image, "image.webp"), ContentFile(data))
    updated = NoteImage.objects.filter(id=image.id).update(
        status=Item.PreviewStatus.READY, image=name
    )
    if not updated:  # removed from the note meanwhile
        default_storage.delete(name)
    elif image.image and image.image.name != name:
        default_storage.delete(image.image.name)
    note_changed(image)


def _note_image_failed(image):
    NoteImage.objects.filter(id=image.id).update(status=Item.PreviewStatus.FAILED)
    note_changed(image)


@shared_task(bind=True, max_retries=len(RETRY_DELAYS))
def fetch_note_links(self, note_id):
    """
    Fetch the preview of each pending card or embed link of a note, image
    included, like link items. Links that can't be fetched for good are
    marked failed; temporary errors retry the ones still pending.
    """
    pending = NoteLink.objects.filter(
        note_id=note_id, status=Item.PreviewStatus.PENDING
    )
    unavailable = None
    for link in pending:
        try:
            preview = build_preview(link.url)
        except TransientFetchError as exc:
            unavailable = exc
            continue
        except FetchError as exc:
            logger.info("Note link preview failed for %s: %s", link.url, exc)
            NoteLink.objects.filter(id=link.id).update(status=Item.PreviewStatus.FAILED)
            note_changed(link)
            continue
        image = None
        if preview.image_url:
            try:
                image = download_preview_image(preview.image_url)
            except TransientFetchError as exc:
                logger.info("Preview image unavailable for %s: %s", link.url, exc)
        _store_note_link(link, preview, image)
    if unavailable:
        _retry_if_possible(self, unavailable)
        for link in pending.all():
            logger.info("Note link unavailable: %s: %s", link.url, unavailable)
            NoteLink.objects.filter(id=link.id).update(status=Item.PreviewStatus.FAILED)
            note_changed(link)


def _store_note_link(link, preview, image):
    name = ""
    if image:
        name = default_storage.save(note_link_image_path(link, ""), ContentFile(image))
    updated = NoteLink.objects.filter(id=link.id).update(
        status=Item.PreviewStatus.READY, metadata=preview.metadata, image=name
    )
    if not updated and name:  # taken out of the note meanwhile
        default_storage.delete(name)
    note_changed(link)


def note_changed(part):
    """A note's image or link preview is done (or failed): it shows now."""
    if part.note_id:
        changed(part.owner_id, items=[part.note_id])
