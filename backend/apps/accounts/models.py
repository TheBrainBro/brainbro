from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel


class Profile(TimestampedModel):
    """What the app remembers about a user across devices."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    # Set the first time the welcome tour is closed, on any device.
    welcome_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Profile of {self.user}"
