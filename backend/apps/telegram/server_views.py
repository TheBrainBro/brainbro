"""
Settings, Telegram, Server bot: the bot this server speaks as, for admins
only.

Saving checks the token with Telegram (`getMe`), which also gives the bot's
username, and stores it encrypted in the database, where it is used instead of
the environment's. The bot's updates come by webhook, at the public address,
so saving points the bot there right away. `DELETE` disconnects the bot and
goes back to the environment's. The token is never sent back.
"""

import logging

from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from apps.core import secrets

from . import bot
from .models import TelegramSettings
from .tasks import register_webhook, webhook_url

logger = logging.getLogger(__name__)

REFUSED = "Telegram didn't accept this token. Copy it again from @BotFather."


def telegram_settings_data():
    current = bot.config()
    return {
        "source": current.source,
        "configured": current.configured,
        "bot_username": current.username,
        # Where Telegram delivers the bot's messages; "" when there is nowhere.
        "webhook_url": webhook_url(),
        # Whether there is anything to go back to.
        "environment_configured": bot.environment_config().configured,
    }


class TelegramSettingsSerializer(serializers.Serializer):
    bot_token = serializers.CharField(max_length=200, trim_whitespace=True)

    def validate_bot_token(self, value):
        try:
            me = bot.call_as(value, "getMe")
        except bot.BotError:
            raise serializers.ValidationError(REFUSED) from None
        if not isinstance(me, dict) or not me.get("username"):
            raise serializers.ValidationError(REFUSED)
        self.context["username"] = me["username"]
        return value


def disconnect(token):
    """Stops Telegram sending this bot's messages here; best effort."""
    try:
        bot.call_as(token, "deleteWebhook")
    except bot.BotError as exc:
        logger.warning("Telegram webhook not removed: %s", exc)


@api_view(["GET", "PUT", "DELETE"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAdminUser])
def telegram_settings_view(request):
    """
    `GET` says how the bot is set up. `PUT {"bot_token"}` checks the token
    with Telegram and saves it here, over the environment. `DELETE`
    disconnects that bot and goes back to the environment's.
    """
    before = bot.config()

    if request.method == "DELETE":
        saved = bot.saved_settings()
        if saved is not None:
            disconnect(before.token)
            saved.delete()
            if bot.configured() and webhook_url():
                register_webhook.delay()
        return Response(telegram_settings_data())

    if request.method == "PUT":
        payload = TelegramSettingsSerializer(data=request.data, context={})
        payload.is_valid(raise_exception=True)
        token = payload.validated_data["bot_token"]
        # The bot it replaces no longer sends its messages here.
        if before.token and before.token != token:
            disconnect(before.token)
        TelegramSettings.objects.update_or_create(
            singleton=True,
            defaults={
                "bot_token": secrets.encrypt(token),
                "bot_username": payload.context["username"],
            },
        )
        if webhook_url():
            register_webhook.delay()
    return Response(telegram_settings_data())
