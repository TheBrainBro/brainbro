"""
A thin client for the Telegram Bot API (https://core.telegram.org/bots/api):
only the methods Brain uses.
"""

import hashlib
import hmac

import requests
from django.conf import settings

API = "https://api.telegram.org"
TIMEOUT = 30
# Bots can't download larger files through the Bot API.
MAX_DOWNLOAD = 20 * 1024 * 1024
CHUNK = 64 * 1024


class BotError(Exception):
    pass


class FileTooLarge(BotError):
    pass


def configured():
    return bool(settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_BOT_USERNAME)


def webhook_secret():
    """Sent by Telegram with every update; derived, so it needs no setting."""
    key = settings.SECRET_KEY.encode()
    return hmac.new(key, b"telegram-webhook", hashlib.sha256).hexdigest()


def call(method, **params):
    """Calls a Bot API method with JSON params; its `result`, or BotError."""
    url = f"{API}/bot{settings.TELEGRAM_BOT_TOKEN}/{method}"
    # Long polling (`timeout`) holds the request open that long.
    wait = TIMEOUT + params.get("timeout", 0)
    try:
        response = requests.post(url, json=params, timeout=wait)
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise BotError(f"{method}: {exc.__class__.__name__}") from None
    if not data.get("ok"):
        raise BotError(f"{method}: {data.get('description', response.status_code)}")
    return data["result"]


def download(file_id, size=None):
    """The bytes of a file a message carries, up to MAX_DOWNLOAD."""
    if size and size > MAX_DOWNLOAD:
        raise FileTooLarge
    path = call("getFile", file_id=file_id).get("file_path")
    if not path:
        raise BotError("getFile: no file_path")
    url = f"{API}/file/bot{settings.TELEGRAM_BOT_TOKEN}/{path}"
    try:
        with requests.get(url, stream=True, timeout=TIMEOUT) as response:
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_content(CHUNK):
                data.extend(chunk)
                if len(data) > MAX_DOWNLOAD:
                    raise FileTooLarge
            return bytes(data)
    except requests.RequestException as exc:
        raise BotError(f"download: {exc.__class__.__name__}") from None


def react(chat_id, message_id, emoji):
    call(
        "setMessageReaction",
        chat_id=chat_id,
        message_id=message_id,
        reaction=[{"type": "emoji", "emoji": emoji}],
    )


def reply(chat_id, text, message_id=None):
    params = {"chat_id": chat_id, "text": text}
    if message_id:
        params["reply_parameters"] = {
            "message_id": message_id,
            "allow_sending_without_reply": True,
        }
    call("sendMessage", **params)
