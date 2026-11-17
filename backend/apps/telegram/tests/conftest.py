import io

import pytest
from PIL import Image

from apps.telegram import bot


@pytest.fixture(autouse=True)
def telegram(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    settings.TELEGRAM_BOT_TOKEN = "123:abc"
    settings.TELEGRAM_BOT_USERNAME = "brainbro_bot"
    settings.TELEGRAM_WEBHOOK_URL = "https://brainbro.example.com/api/telegram/webhook/"


class FakeBot:
    """
    Records Bot API calls; `files` are what downloads return, by file_id, and
    `bots` the usernames of the tokens Telegram accepts.
    """

    def __init__(self):
        self.calls = []
        self.files = {}
        self.bots = {"123:abc": "brainbro_bot"}
        # Calls made with a token of their own: (token, method).
        self.as_bot = []

    def call(self, method, **params):
        self.calls.append((method, params))
        return True

    def call_as(self, token, method, **params):
        self.as_bot.append((token, method))
        if token not in self.bots:
            raise bot.BotError(f"{method}: Unauthorized")
        if method == "getMe":
            return {"id": 1, "is_bot": True, "username": self.bots[token]}
        return True

    def download(self, file_id, size=None):
        if size and size > bot.MAX_DOWNLOAD:
            raise bot.FileTooLarge
        return self.files[file_id]

    def sent(self, method):
        return [params for name, params in self.calls if name == method]


@pytest.fixture
def fake_bot(monkeypatch):
    fake = FakeBot()
    monkeypatch.setattr(bot, "call", fake.call)
    monkeypatch.setattr(bot, "call_as", fake.call_as)
    monkeypatch.setattr(bot, "download", fake.download)
    return fake


def png(color="red"):
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), color).save(buffer, "PNG")
    return buffer.getvalue()
