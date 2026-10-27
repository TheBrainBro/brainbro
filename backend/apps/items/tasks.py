import logging

from celery import shared_task
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from .models import Item, preview_image_path
from .previews import build_preview, download_preview_image
from .safe_http import FetchError, TransientFetchError

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
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=RETRY_DELAYS[self.request.retries])
        return _mark_failed(item, exc)
    except FetchError as exc:
        return _mark_failed(item, exc)

    image_name = ""
    if preview.image_url and (data := download_preview_image(preview.image_url)):
        image_name = default_storage.save(
            preview_image_path(item, ""), ContentFile(data)
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
