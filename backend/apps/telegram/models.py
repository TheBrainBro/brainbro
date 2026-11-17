from django.conf import settings
from django.db import models

from apps.core.models import OwnedModel, TimestampedModel


class TelegramLink(OwnedModel):
    """
    The Telegram chat whose messages land in its owner's inbox. Linking goes
    through a one-time `code`, sent to the bot as `/start <code>` from a link
    the app opens; until then `chat_id` is empty. Any other chat is ignored.
    """

    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    code = models.CharField(max_length=64, null=True, blank=True, unique=True)
    code_expires_at = models.DateTimeField(null=True, blank=True)
    chat_id = models.BigIntegerField(null=True, blank=True, unique=True)
    # How the chat's user is called on Telegram, to show who is linked.
    telegram_name = models.CharField(max_length=255, blank=True)
    linked_at = models.DateTimeField(null=True, blank=True)
    # The last update handled from this chat: Telegram retries deliveries,
    # and an update is only saved once.
    last_update_id = models.BigIntegerField(default=0)

    def __str__(self):
        return f"Telegram {self.telegram_name or self.chat_id or 'pending'}"


class TelegramSettings(TimestampedModel):
    """
    The bot this server speaks as, set by an admin in Settings, Server,
    Telegram. One row at most: while it exists it is used instead of the
    environment (apps.telegram.bot). The token is stored encrypted
    (apps.core.secrets); the username comes from Telegram (`getMe`).
    """

    # Keeps it to one row.
    singleton = models.BooleanField(default=True, unique=True, editable=False)
    bot_token = models.TextField()
    bot_username = models.CharField(max_length=64)

    class Meta:
        verbose_name_plural = "Telegram settings"

    def __str__(self):
        return f"Telegram bot @{self.bot_username}"
