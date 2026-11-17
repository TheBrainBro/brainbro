"""
A thin client for the Telegram Bot API (https://core.telegram.org/bots/api):
only the methods BrainBro uses.

Which bot it speaks as is read in one place, `config()`: the one an admin set
up in Settings, Telegram, or, while there is none, the environment's
(`TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`).
"""

import hashlib
import hmac
from dataclasses import dataclass

import requests
from django.apps import apps
from django.conf import settings
from django.db import DatabaseError

from apps.core import secrets

API = "https://api.telegram.org"
TIMEOUT = 30
# Bots can't download larger files through the Bot API.
MAX_DOWNLOAD = 20 * 1024 * 1024
CHUNK = 64 * 1024


class BotError(Exception):
    pass


class FileTooLarge(BotError):
    pass


DATABASE = "database"
ENVIRONMENT = "environment"


@dataclass(frozen=True)
class Config:
    """The bot the server is set up with, whichever place it came from."""

    source: str
    token: str = ""
    username: str = ""

    @property
    def configured(self):
        return bool(self.token and self.username)


def environment_config():
    return Config(
        source=ENVIRONMENT,
        token=settings.TELEGRAM_BOT_TOKEN,
        username=settings.TELEGRAM_BOT_USERNAME,
    )


def saved_settings():
    """The bot set up from the app, if any."""
    # By name, like apps.core.mail: no model import in the client.
    TelegramSettings = apps.get_model("telegram", "TelegramSettings")
    try:
        return TelegramSettings.objects.first()
    except DatabaseError:
        # Before the first migration: only the environment counts.
        return None


def config():
    saved = saved_settings()
    if saved is None:
        return environment_config()
    return Config(
        source=DATABASE,
        token=secrets.decrypt(saved.bot_token),
        username=saved.bot_username,
    )


def configured():
    return config().configured


def username():
    return config().username


def webhook_secret():
    """Sent by Telegram with every update; derived, so it needs no setting."""
    key = settings.SECRET_KEY.encode()
    return hmac.new(key, b"telegram-webhook", hashlib.sha256).hexdigest()


def call(method, **params):
    """Calls a Bot API method as the configured bot; its `result`, or BotError."""
    return call_as(config().token, method, **params)


def call_as(token, method, **params):
    """Calls a Bot API method as the bot `token` belongs to."""
    if not token:
        raise BotError(f"{method}: no bot token")
    url = f"{API}/bot{token}/{method}"
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
    url = f"{API}/file/bot{config().token}/{path}"
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
