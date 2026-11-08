"""
Notes and boards leave a revision on every save that changes their content.
Bulk updates skip these signals, and none of them touches that content.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.boards.models import Board
from apps.items.models import Item
from apps.items.origin import Origin, current

from .recording import BOARD_FIELDS, NOTE_FIELDS, record


def touches(update_fields, fields):
    return update_fields is None or bool(set(update_fields) & set(fields))


@receiver(post_save, sender=Item)
def note_saved(sender, instance, created, raw=False, update_fields=None, **kwargs):
    if raw or instance.kind != Item.Kind.NOTE:
        return
    if not touches(update_fields, NOTE_FIELDS):
        return
    # The note says who made it and who edited it last (live edits come from
    # no request, so only the note knows they were the user's on the web).
    if created or not instance.edited_at:
        made = Origin(
            by=instance.created_by,
            via=instance.created_via,
            logo=instance.created_logo,
        )
    else:
        made = Origin(
            by=instance.edited_by,
            via=instance.edited_via,
            logo=instance.edited_logo,
        )
    content = {name: getattr(instance, name) for name in NOTE_FIELDS}
    record(instance.owner_id, content, made, item=instance)


@receiver(post_save, sender=Board)
def board_saved(sender, instance, raw=False, update_fields=None, **kwargs):
    if raw or not touches(update_fields, BOARD_FIELDS):
        return
    content = {name: getattr(instance, name) for name in BOARD_FIELDS}
    record(instance.owner_id, content, current(), board=instance)
