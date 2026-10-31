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


class OAuthClient(TimestampedModel):
    """
    An app that connects through "Sign in to Brain" (OAuth): ChatGPT, Claude,
    Grok… Apps register themselves (dynamic client registration), so nothing
    here is trusted: the user sees the name and where it sends them back
    before allowing it. Its `id` is the OAuth `client_id`.
    """

    name = models.CharField(max_length=200)
    # Exact URIs it may be sent back to with a code.
    redirect_uris = models.JSONField(default=list)
    # Empty for public clients, which prove themselves with PKCE only.
    secret_hash = models.CharField(max_length=64, blank=True)

    def __str__(self):
        return self.name


class AuthorizationCode(OwnedModel):
    """What the user's "Allow" gives the app: swapped once for a token."""

    client = models.ForeignKey(OAuthClient, on_delete=models.CASCADE)
    code_hash = models.CharField(max_length=64, unique=True)
    redirect_uri = models.CharField(max_length=2048)
    # PKCE (S256): only who started the sign-in can use the code.
    code_challenge = models.CharField(max_length=128)
    expires_at = models.DateTimeField()


class ApiToken(OwnedModel):
    """
    What clients outside the web app (MCP, scripts) send as
    `Authorization: Bearer <token>`. Only hashes are stored. Revoking deletes
    it.

    Either a personal token, made in the app and shown once, that never
    expires; or an app connected by signing in (`client`), whose key lasts
    an hour and is renewed with `refresh_hash`, a new pair every time.
    """

    name = models.CharField(max_length=100)
    # The start of the token, to tell tokens apart in the list.
    prefix = models.CharField(max_length=16)
    key_hash = models.CharField(max_length=64, unique=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    client = models.ForeignKey(
        OAuthClient, on_delete=models.CASCADE, null=True, blank=True
    )
    expires_at = models.DateTimeField(null=True, blank=True)
    refresh_hash = models.CharField(max_length=64, unique=True, null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.prefix}…)"

    @staticmethod
    def hash(key):
        # Tokens are long and random: a fast hash is enough, nothing to guess.
        return hashlib.sha256(key.encode()).hexdigest()

    @staticmethod
    def new_key():
        return f"{TOKEN_PREFIX}{secrets.token_urlsafe(32)}"

    @classmethod
    def issue(cls, owner, name, client=None):
        """A new token and its key, which is never stored."""
        key = cls.new_key()
        token = cls(owner=owner, name=name, client=client)
        token.set_key(key)
        token.save()
        return token, key

    def set_key(self, key):
        self.prefix = key[: len(TOKEN_PREFIX) + 4]
        self.key_hash = self.hash(key)
