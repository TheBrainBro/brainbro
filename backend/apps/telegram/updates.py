"""
Updates from Telegram: `/start <code>` links a chat, and every message from
a linked chat is saved to its owner's inbox, answered with a reaction.
Private chats only; anyone else writing to the bot is ignored.
"""

import logging

from django.utils import timezone

from . import bot
from .messages import Unsupported, save_message
from .models import TelegramLink

logger = logging.getLogger(__name__)

SAVED = "👍"
NOT_SAVED = "👎"


def handle_update(update):
    """The item saved from the update, if any."""
    message = update.get("message")
    if (
        not isinstance(message, dict)
        or message.get("chat", {}).get("type") != "private"
    ):
        return
    chat_id = message["chat"]["id"]
    text = message.get("text") or ""
    if text == "/start" or text.startswith("/start "):
        _start(message, text.removeprefix("/start").strip())
        return

    link = TelegramLink.objects.filter(chat_id=chat_id).select_related("owner").first()
    if link is None:
        return
    # Telegram retries deliveries: each update is saved once.
    update_id = update.get("update_id", 0)
    fresh = TelegramLink.objects.filter(id=link.id, last_update_id__lt=update_id)
    if not fresh.update(last_update_id=update_id):
        return

    message_id = message.get("message_id")
    try:
        item = save_message(link.owner, message)
    except Unsupported:
        _failed(chat_id, message_id, "Brain can't keep this kind of message.")
    except bot.FileTooLarge:
        _failed(
            chat_id,
            message_id,
            "This file is over 20 MB, the most a Telegram bot can download.",
        )
    except Exception:
        logger.exception("Telegram message %s not saved", message_id)
        _failed(chat_id, message_id, "Couldn't save this. Try sending it again.")
    else:
        _tell(bot.react, chat_id, message_id, SAVED)
        return item
    return None


def _start(message, code):
    chat_id = message["chat"]["id"]
    link = (
        TelegramLink.objects.filter(
            code=code, code_expires_at__gt=timezone.now()
        ).first()
        if code
        else None
    )
    if link is None:
        if TelegramLink.objects.filter(chat_id=chat_id).exists():
            _tell(
                bot.reply, chat_id, "This chat is connected. Send anything to save it."
            )
        else:
            _tell(
                bot.reply,
                chat_id,
                "To connect, open Brain and choose Connect Telegram "
                "in the account menu.",
            )
        return
    sender = message.get("from") or {}
    name = sender.get("username") and f"@{sender['username']}"
    # A chat belongs to one account.
    TelegramLink.objects.filter(chat_id=chat_id).exclude(id=link.id).update(
        chat_id=None, linked_at=None
    )
    link.chat_id = chat_id
    link.telegram_name = name or sender.get("first_name", "")
    link.code = None
    link.code_expires_at = None
    link.linked_at = timezone.now()
    link.last_update_id = 0
    link.save()
    _tell(
        bot.reply,
        chat_id,
        "Connected to Brain. Send or forward anything here and it lands in your inbox.",
    )


def _failed(chat_id, message_id, text):
    _tell(bot.react, chat_id, message_id, NOT_SAVED)
    _tell(bot.reply, chat_id, text, message_id)


def _tell(method, *args):
    """Answers are a courtesy: failing to send one changes nothing."""
    try:
        method(*args)
    except bot.BotError as exc:
        logger.warning("Telegram answer failed: %s", exc)
