from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver

from apps.core.models import OwnedModel


class Export(OwnedModel):
    """
    A full export of a user's data, built in the background (`tasks`) as a
    zip in EXPORT_DIR. Only the latest one is kept, and only for a while.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    status = models.CharField(max_length=8, choices=Status, default=Status.PENDING)
    size = models.PositiveBigIntegerField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Export {self.created_at:%Y-%m-%d %H:%M} ({self.status})"

    @property
    def path(self):
        return settings.EXPORT_DIR / f"{self.id}.zip"

    @property
    def filename(self):
        return f"brainbro-export-{self.created_at:%Y-%m-%d}.zip"


@receiver(post_delete, sender=Export)
def delete_export_file(sender, instance, **kwargs):
    instance.path.unlink(missing_ok=True)
    instance.path.with_suffix(".partial").unlink(missing_ok=True)
