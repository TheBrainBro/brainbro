"""
Every save that changes a note's title or body, or a board's title or layout,
leaves a revision (see `receivers`). Autosave saves every few seconds, so
saves by the same author within `WINDOW` of a revision's start go into it
instead of making a new one. A restore always makes its own, and nothing goes
into it afterwards: what was there before it stays in the history.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import timedelta

from django.utils import timezone

from .models import Revision

WINDOW = timedelta(minutes=5)

# What a note or board holds, as a revision keeps it.
NOTE_FIELDS = ("title", "body")
BOARD_FIELDS = ("title", "layout")

_restoring: ContextVar[Revision | None] = ContextVar("restoring", default=None)


@contextmanager
def restoring(revision):
    """What is saved inside is `revision` coming back."""
    token = _restoring.set(revision)
    try:
        yield
    finally:
        _restoring.reset(token)


def same(name, kept, saved):
    if name == "layout":
        # Panning and zooming a board isn't a change worth a revision.
        return {**kept, "viewport": None} == {**saved, "viewport": None}
    return kept == saved


def record(owner_id, content, made, **target):
    """
    `content` (field: value) was just saved to `target` (`item=` or `board=`)
    by `made` (an `Origin`). Returns the revision it went into, or None when
    it is what the latest one already has.
    """
    latest = Revision.objects.filter(**target).order_by("-created_at").first()
    if latest and all(
        same(name, getattr(latest, name), value) for name, value in content.items()
    ):
        return None
    restored = _restoring.get()
    if (
        latest
        and restored is None
        and latest.restored_from_id is None
        and (latest.by, latest.via, latest.logo) == (made.by, made.via, made.logo)
        and timezone.now() - latest.created_at < WINDOW
    ):
        for name, value in content.items():
            setattr(latest, name, value)
        latest.save(update_fields=[*content, "updated_at"])
        return latest
    return Revision.objects.create(
        owner_id=owner_id,
        by=made.by,
        via=made.via,
        logo=made.logo,
        restored_from=restored,
        **target,
        **content,
    )
