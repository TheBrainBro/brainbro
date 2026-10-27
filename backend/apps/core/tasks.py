import logging
import os
import subprocess
from datetime import datetime, timezone

from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)


@shared_task
def backup_database():
    """
    Dump the database to BACKUP_DIR and keep the newest BACKUP_RETENTION dumps.

    Uses pg_dump's custom format, restorable with scripts/restore-db.sh.
    """
    db = settings.DATABASES["default"]
    backup_dir = settings.BACKUP_DIR
    backup_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    target = backup_dir / f"{db['NAME']}-{stamp}.dump"
    partial = target.with_suffix(".dump.partial")

    subprocess.run(
        [
            "pg_dump",
            "--format=custom",
            "--host",
            db["HOST"],
            "--port",
            str(db["PORT"]),
            "--username",
            db["USER"],
            "--file",
            str(partial),
            db["NAME"],
        ],
        env={**os.environ, "PGPASSWORD": db["PASSWORD"]},
        check=True,
        capture_output=True,
    )
    # Only complete dumps get the final name, so retention never keeps a
    # half-written file in place of a good one.
    partial.rename(target)

    dumps = sorted(backup_dir.glob(f"{db['NAME']}-*.dump"), reverse=True)
    for old in dumps[settings.BACKUP_RETENTION :]:
        old.unlink()

    logger.info("Database backup written to %s", target)
    return str(target)
