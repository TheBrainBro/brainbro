from urllib.parse import parse_qs, urlsplit

from apps.items.models import Item
from apps.telegram import bot
from apps.telegram.models import TelegramLink


def test_status_and_connect(api, user, fake_bot):
    status = api.get("/api/telegram/").json()
    assert status == {
        "configured": True,
        "bot_username": "brainbro_bot",
        "linked": False,
        "telegram_name": "",
        "linked_at": None,
    }

    url = api.post("/api/telegram/connect/").json()["url"]

    parts = urlsplit(url)
    assert f"{parts.netloc}{parts.path}" == "t.me/brainbro_bot"
    code = parse_qs(parts.query)["start"][0]
    assert TelegramLink.objects.get(owner=user).code == code
    # A new link replaces the old code.
    api.post("/api/telegram/connect/")
    assert TelegramLink.objects.get(owner=user).code != code


def test_linked_and_disconnected(api, user):
    TelegramLink.objects.create(owner=user, chat_id=42, telegram_name="@me")

    assert api.get("/api/telegram/").json()["telegram_name"] == "@me"
    assert api.delete("/api/telegram/").status_code == 204
    assert not TelegramLink.objects.exists()


def test_without_a_bot(api, settings):
    settings.TELEGRAM_BOT_TOKEN = ""

    assert api.get("/api/telegram/").json()["configured"] is False
    assert api.post("/api/telegram/connect/").status_code == 409


def test_the_webhook_needs_the_secret(client, user, fake_bot):
    TelegramLink.objects.create(owner=user, chat_id=42)
    body = {
        "update_id": 1,
        "message": {
            "message_id": 1,
            "chat": {"id": 42, "type": "private"},
            "text": "hi",
        },
    }

    refused = client.post(
        "/api/telegram/webhook/", body, content_type="application/json"
    )
    wrong = client.post(
        "/api/telegram/webhook/",
        body,
        content_type="application/json",
        HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="nope",
    )
    accepted = client.post(
        "/api/telegram/webhook/",
        body,
        content_type="application/json",
        HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=bot.webhook_secret(),
    )

    assert (refused.status_code, wrong.status_code, accepted.status_code) == (
        403,
        403,
        200,
    )
    assert Item.objects.get().body == "hi"


def test_only_signed_in_users_see_the_connection(client):
    assert client.get("/api/telegram/").status_code == 403
