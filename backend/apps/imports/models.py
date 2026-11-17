import uuid

from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver

from apps.core.models import OwnedModel


def import_path(vault_import, filename):
    return f"imports/{vault_import.id}/{uuid.uuid4().hex}.zip"


class Import(OwnedModel):
    """
    A zip uploaded to be imported in the background (`tasks`): an Obsidian
    vault or a BrainBro export. The zip is deleted once it has been read.
    """

    class Source(models.TextChoices):
        OBSIDIAN = "obsidian", "Obsidian"
        BRAINBRO = "brainbro", "BrainBro"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    status = models.CharField(max_length=8, choices=Status, default=Status.PENDING)
    # What the zip holds, told by its files when uploaded.
    source = models.CharField(max_length=8, choices=Source, default=Source.OBSIDIAN)
    filename = models.CharField(max_length=255, blank=True)
    file = models.FileField(upload_to=import_path, max_length=255, blank=True)
    # What was created: notes, images, files, links, albums, boards,
    # collections; how many files were skipped and, for a BrainBro export,
    # how many things were already there.
    counts = models.JSONField(default=dict, blank=True)
    # Why it failed, when the vault itself was the problem.
    error = models.CharField(max_length=255, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Import {self.filename} ({self.status})"


@receiver(post_delete, sender=Import)
def delete_import_file(sender, instance, **kwargs):
    if instance.file:
        instance.file.delete(save=False)
