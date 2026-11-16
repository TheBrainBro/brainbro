import uuid

from django.conf import settings
from django.db import models


class TimestampedModel(models.Model):
    """UUID primary key plus creation/update timestamps."""

    # UUIDs keep ids stable across exports, imports and future sync.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class OwnedModel(TimestampedModel):
    """
    Base for every user content model: every row belongs to one user, and
    only they can reach it (see `apps.core.tests.test_isolation`).
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="+",
    )

    class Meta:
        abstract = True


class EmailSettings(TimestampedModel):
    """
    How this server sends email, set by an admin in Settings, Server, Email.
    One row at most: while it exists it is used instead of the environment
    (apps.core.mail). The API key is stored encrypted (apps.core.secrets).
    """

    class Provider(models.TextChoices):
        NONE = "", "None"
        MAILGUN = "mailgun", "Mailgun"

    class Region(models.TextChoices):
        US = "us", "US"
        EU = "eu", "EU"

    # Keeps it to one row.
    singleton = models.BooleanField(default=True, unique=True, editable=False)
    provider = models.CharField(
        max_length=20, choices=Provider.choices, blank=True, default=""
    )
    from_email = models.CharField(max_length=254, blank=True)
    mailgun_domain = models.CharField(max_length=253, blank=True)
    mailgun_region = models.CharField(
        max_length=2, choices=Region.choices, default=Region.US
    )
    mailgun_api_key = models.TextField(blank=True)

    class Meta:
        verbose_name_plural = "email settings"

    def __str__(self):
        return "Email settings"
