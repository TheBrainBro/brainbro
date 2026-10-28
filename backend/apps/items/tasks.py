import logging

from celery import shared_task
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from .models import Item, preview_image_path
from .previews import build_preview, download_preview_image, reencode_image
from .safe_http import FetchError, TransientFetchError
from .uploads import IMAGE_FORMATS, MAX_IMAGE_PIXELS

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


def _mark_failed(item, exc):
    logger.info("Link preview failed for %s: %s", item.url, exc)
    Item.objects.filter(id=item.id).update(
        preview_status=Item.PreviewStatus.FAILED,
        metadata={**item.metadata, "preview_error": str(exc)[:500]},
    )


@shared_task
def generate_thumbnail(item_id):
    """Re-encode an uploaded image as its card image (a bounded WebP)."""
    item = Item.objects.filter(id=item_id, kind=Item.Kind.IMAGE).first()
    if item is None or not item.file:
        return

    with item.file.open("rb") as source:
        thumbnail = reencode_image(source, IMAGE_FORMATS, MAX_IMAGE_PIXELS)
    if thumbnail is None:
        logger.info("Could not make a thumbnail for item %s", item.id)
        Item.objects.filter(id=item.id).update(preview_status=Item.PreviewStatus.FAILED)
        return

    name = default_storage.save(preview_image_path(item, ""), ContentFile(thumbnail))
    updated = Item.objects.filter(id=item.id).update(
        preview_status=Item.PreviewStatus.READY, preview_image=name
    )
    if not updated:  # deleted meanwhile
        default_storage.delete(name)
    elif item.preview_image and item.preview_image.name != name:
        default_storage.delete(item.preview_image.name)
