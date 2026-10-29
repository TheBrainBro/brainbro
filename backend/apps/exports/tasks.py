import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .archive import write_export
from .models import Export

logger = logging.getLogger(__name__)


# Exports copy every upload, so a large account can take a while.
BUILD_TIME_LIMIT = 2 * 60 * 60


@shared_task(time_limit=BUILD_TIME_LIMIT, soft_time_limit=BUILD_TIME_LIMIT - 60)
def build_export(export_id):
    export = Export.objects.filter(id=export_id).select_related("owner").first()
    if export is None or export.status != Export.Status.PENDING:
        return
    settings.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    # Only complete zips get the final name.
    partial = export.path.with_suffix(".partial")
    try:
        write_export(export.owner, partial, now=export.created_at)
        partial.rename(export.path)
    except Exception:
        logger.exception("Export %s failed", export.id)
        partial.unlink(missing_ok=True)
        Export.objects.filter(id=export.id).update(
            status=Export.Status.FAILED, finished_at=timezone.now()
        )
        return
    updated = Export.objects.filter(id=export.id).update(
        status=Export.Status.READY,
        size=export.path.stat().st_size,
        finished_at=timezone.now(),
    )
    if not updated:  # replaced or deleted meanwhile
        export.path.unlink(missing_ok=True)


@shared_task
def delete_old_exports():
    """Exports are a copy of everything: they don't stay around for long."""
    cutoff = timezone.now() - timedelta(hours=settings.EXPORT_RETENTION_HOURS)
    for export in Export.objects.filter(created_at__lt=cutoff):
        export.delete()
