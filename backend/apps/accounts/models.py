import hashlib
import secrets

from django.conf import settings
from django.db import models

from apps.core.models import OwnedModel, TimestampedModel

# Says what a token is when it turns up somewhere it shouldn't.
TOKEN_PREFIX = "brain_"


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


class ApiToken(OwnedModel):
    """
    A personal token for clients outside the web app (MCP, scripts), sent as
    `Authorization: Bearer <token>`. Only a hash is stored: the token itself
    is shown once, when it is created. Revoking deletes it.
    """

    name = models.CharField(max_length=100)
    # The start of the token, to tell tokens apart in the list.
    prefix = models.CharField(max_length=16)
    key_hash = models.CharField(max_length=64, unique=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.prefix}…)"

    @staticmethod
    def hash(key):
        # Tokens are long and random: a fast hash is enough, nothing to guess.
        return hashlib.sha256(key.encode()).hexdigest()

    @classmethod
    def issue(cls, owner, name):
        """A new token and its key, which is never stored."""
        key = f"{TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
        token = cls.objects.create(
            owner=owner,
            name=name,
            prefix=key[: len(TOKEN_PREFIX) + 4],
            key_hash=cls.hash(key),
        )
        return token, key
