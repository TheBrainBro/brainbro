import logging

from celery import shared_task
from django.utils import timezone

from .models import Import
from .vault import VaultError, import_vault

logger = logging.getLogger(__name__)


# A large vault means thousands of files to store.
IMPORT_TIME_LIMIT = 2 * 60 * 60


@shared_task(time_limit=IMPORT_TIME_LIMIT, soft_time_limit=IMPORT_TIME_LIMIT - 60)
def run_import(import_id):
    vault_import = Import.objects.filter(id=import_id).select_related("owner").first()
    if vault_import is None or vault_import.status != Import.Status.PENDING:
        return
    error = ""
    counts = {}
    try:
        with vault_import.file.open("rb") as source:
            counts = import_vault(vault_import.owner, source)
    except VaultError as exc:
        error = str(exc)
    except Exception:
        logger.exception("Import %s failed", vault_import.id)
        error = "Something went wrong while importing. Nothing was imported."
    # The zip has been read either way; only the result is kept.
    vault_import.file.delete(save=False)
    vault_import.status = Import.Status.FAILED if error else Import.Status.READY
    vault_import.error = error
    vault_import.counts = counts
    vault_import.finished_at = timezone.now()
    vault_import.save(
        update_fields=["status", "error", "counts", "file", "finished_at", "updated_at"]
    )
