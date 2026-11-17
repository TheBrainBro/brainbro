import hmac
import secrets
from datetime import timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import bot
from .models import TelegramLink
from .tasks import process_update

# How long the link the app opens can be used to connect.
CODE_LIFETIME = timedelta(hours=1)


class TelegramView(APIView):
    """
    The current user's connection to the bot. `GET` says whether the bot is
    set up and which chat is linked; `DELETE` disconnects.
    """

    def get(self, request):
        link = TelegramLink.objects.filter(
            owner=request.user, chat_id__isnull=False
        ).first()
        return Response(
            {
                "configured": bot.configured(),
                "bot_username": bot.username(),
                "linked": link is not None,
                "telegram_name": link.telegram_name if link else "",
                "linked_at": link.linked_at if link else None,
            }
        )

    def delete(self, request):
        TelegramLink.objects.filter(owner=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TelegramConnectView(APIView):
    """`POST` makes a one-time link that opens the bot and connects the chat."""

    def post(self, request):
        if not bot.configured():
            return Response(
                {"detail": "The Telegram bot isn't set up on this server."},
                status=status.HTTP_409_CONFLICT,
            )
        code = secrets.token_urlsafe(24)
        TelegramLink.objects.update_or_create(
            owner=request.user,
            defaults={"code": code, "code_expires_at": timezone.now() + CODE_LIFETIME},
        )
        url = f"https://t.me/{bot.username()}?start={code}"
        return Response({"url": url})


class TelegramWebhookView(APIView):
    """Telegram posts updates here, with the secret set by `register_webhook`."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        if not bot.configured():
            return Response(status=status.HTTP_404_NOT_FOUND)
        sent = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if not hmac.compare_digest(sent, bot.webhook_secret()):
            return Response(status=status.HTTP_403_FORBIDDEN)
        if isinstance(request.data, dict):
            # Answered right away: downloads happen in the worker.
            process_update.delay(request.data)
        return Response(status=status.HTTP_200_OK)
