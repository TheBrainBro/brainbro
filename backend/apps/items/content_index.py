"""Checkpoint an upload by page or audio chunk. Sweep older files between captures."""

import logging
from contextlib import closing
from datetime import timedelta
from pathlib import Path
from time import monotonic

from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.db.models.functions import Length
from django.utils import timezone

from apps.events.changes import changed

from . import extractors
from .models import FileIndex, Item, ItemPassage

logger = logging.getLogger(__name__)
# Longer than the task's hard limit. A lost worker's lease eventually expires.
LEASE = timedelta(minutes=20)
RETRY_DELAY = timedelta(minutes=5)
MAX_ATTEMPTS = 3
BACKFILL_FILES = 32
# Finish the current unit, then give other tasks a turn.
SLICE_SECONDS = 10


@transaction.atomic
def _claim(item_id, newest):
    now = timezone.now()
    items = (
        Item.objects.exclude(file="")
        .filter(
            Q(metadata__mime__in=sorted(extractors.SUPPORTED_MIMES))
            | Q(metadata__mime__startswith="text/")
        )
        .filter(
            Q(file_index__isnull=True)
            | ~Q(file_index__source=F("file"))
            | Q(file_index__retry_at__lte=now)
        )
    )
    if item_id is not None:
        items = items.filter(pk=item_id)
    item = (
        items.order_by("-created_at" if newest else "created_at", "pk")
        .select_for_update(of=("self",), skip_locked=True)
        .first()
    )
    if item is None:
        return None
    index, created = FileIndex.objects.get_or_create(
        item=item, defaults={"source": item.file.name}
    )
    if index.source != item.file.name:
        item.passages.all().delete()
        index.source, index.cursor, index.attempts = item.file.name, 0, 0
    elif not created and (index.retry_at is None or index.retry_at > now):
        return None
    # Count starts, including workers that die before they can report failure.
    index.attempts += 1
    index.retry_at = now + LEASE
    index.save()
    return item, index


@transaction.atomic
def _checkpoint(item, lease, cursor, rows):
    # Claims and writes lock the parent first. A replacement or deletion wins
    # over a late worker, even when extraction finished outside the lock.
    if not Item.objects.select_for_update().filter(pk=item.pk, file=item.file).exists():
        return False
    if not lease.update(cursor=cursor, attempts=1):
        return False
    if rows:
        ItemPassage.objects.bulk_create(rows, batch_size=100)
        changed(item.owner_id, items=[item.pk])
    return True


def _passage_rows(item, passages, position, remaining):
    rows = []
    for part in passages:
        if remaining <= 0 or position >= extractors.MAX_PASSAGES:
            break
        text = part.text[:remaining]
        if not text:
            continue
        rows.append(
            ItemPassage(
                item=item,
                position=position,
                text=text,
                page=part.page,
                start_seconds=part.start_seconds,
                end_seconds=part.end_seconds,
                words=part.words,
            )
        )
        remaining -= len(text)
        position += 1
    return rows, remaining


def _index_file(item, index, deadline):
    lease = FileIndex.objects.filter(
        pk=item.pk, source=index.source, retry_at=index.retry_at
    )
    if index.attempts > MAX_ATTEMPTS:
        lease.update(retry_at=None)
        logger.warning("Worker attempts exhausted for item %s", item.pk)
        return 0
    totals = item.passages.aggregate(count=Count("pk"), chars=Sum(Length("text")))
    position = totals["count"]
    remaining = extractors.MAX_TEXT_CHARS - (totals["chars"] or 0)
    if remaining <= 0 or position >= extractors.MAX_PASSAGES:
        return lease.update(retry_at=None, attempts=0)
    try:
        with closing(
            extractors.extract_batches(
                Path(item.file.path), item.metadata["mime"], index.cursor
            )
        ) as batches:
            for batch in batches:
                rows, remaining = _passage_rows(
                    item, batch.passages, position, remaining
                )
                position += len(rows)
                if not _checkpoint(item, lease, batch.next_cursor, rows):
                    return 0
                index.attempts = 1
                if remaining <= 0 or position >= extractors.MAX_PASSAGES:
                    break
                if monotonic() >= deadline:
                    lease.update(retry_at=timezone.now(), attempts=0)
                    return 0
    except extractors.UnreadableFile as exc:
        logger.info("Cannot index item %s: %s", item.pk, exc)
        lease.update(retry_at=None)
        return 0
    except Exception:
        logger.exception("Content extraction failed for item %s", item.pk)
        retry = timezone.now() + RETRY_DELAY if index.attempts < MAX_ATTEMPTS else None
        lease.update(retry_at=retry)
        return 0
    return lease.update(retry_at=None, attempts=0)


def index_uploads(item_id=None):
    """Target one committed capture, or take a bounded batch from the backlog."""
    deadline = monotonic() + SLICE_SECONDS
    finished = 0
    for number in range(1 if item_id is not None else BACKFILL_FILES):
        # Cover new files promptly even if dispatch failed. Remaining slots
        # go to the oldest eligible uploads, including interrupted imports.
        claim = _claim(item_id, newest=number == 0)
        if claim is None:
            break
        finished += _index_file(*claim, deadline)
        if monotonic() >= deadline:
            break
    return finished
