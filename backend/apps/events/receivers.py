"""
Changes saved one object at a time. Bulk updates skip these signals: where
they change what a user sees, the code that makes them calls `changed`.
"""

from celery.signals import task_postrun, task_prerun
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.boards.models import Board
from apps.items.models import Collection, Item, NoteImage, NoteLink

from .changes import changed, collect


@receiver(post_save, sender=Item)
@receiver(post_delete, sender=Item)
def item_changed(sender, instance, **kwargs):
    # An album shows its images.
    album = [instance.album_id] if instance.album_id else []
    changed(instance.owner_id, items=[instance.id, *album])


@receiver(post_save, sender=NoteImage)
@receiver(post_save, sender=NoteLink)
def note_part_changed(sender, instance, **kwargs):
    if instance.note_id:
        changed(instance.owner_id, items=[instance.note_id])


@receiver(post_save, sender=Collection)
@receiver(post_delete, sender=Collection)
def collection_changed(sender, instance, **kwargs):
    changed(instance.owner_id)


@receiver(post_save, sender=Board)
def board_saved(sender, instance, **kwargs):
    changed(instance.owner_id, boards={instance.id: instance.revision})


@receiver(post_delete, sender=Board)
def board_deleted(sender, instance, **kwargs):
    changed(instance.owner_id)


# A task's changes go out as one message when it ends, like a request's.
_task_changes = {}


@task_prerun.connect
def start_collecting(task_id, **kwargs):
    changes = collect()
    changes.__enter__()
    _task_changes[task_id] = changes


@task_postrun.connect
def send_collected(task_id, **kwargs):
    changes = _task_changes.pop(task_id, None)
    if changes is not None:
        changes.__exit__(None, None, None)
