import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from apps.core import public_address, secrets
from apps.telegram import bot
from apps.telegram.models import TelegramSettings

URL = "/api/server/telegram/"
HOOK = "https://brainbro.example.com/api/telegram/webhook/"
NEW = "456:def"


@pytest.fixture
def admin(db):
    user = get_user_model().objects.create_user(
        username="admin", password="pw", is_staff=True
    )
    client = Client()
    client.force_login(user)
    return client


@pytest.fixture
def no_environment(settings):
    settings.TELEGRAM_BOT_TOKEN = ""
    settings.TELEGRAM_BOT_USERNAME = ""


def put(client, token):
    return client.put(URL, {"bot_token": token}, content_type="application/json")


def webhooks(fake_bot):
    return [params["url"] for params in fake_bot.sent("setWebhook")]


def test_only_admins_see_it(api, user):
    client = Client()
    client.force_login(user)

    assert client.get(URL).status_code == 403
    assert put(client, NEW).status_code == 403
    assert Client().get(URL).status_code in (401, 403)


def test_it_shows_the_environment_bot(admin):
    assert admin.get(URL).json() == {
        "source": "environment",
        "configured": True,
        "bot_username": "brainbro_bot",
        "webhook_url": HOOK,
        "environment_configured": True,
    }


def test_saving_a_token_switches_to_that_bot(admin, api, fake_bot):
    fake_bot.bots[NEW] = "new_bot"

    response = put(admin, f"  {NEW} ")

    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "database"
    assert data["configured"] is True
    # From Telegram: nothing else to type.
    assert data["bot_username"] == "new_bot"
    assert NEW not in str(data)
    saved = TelegramSettings.objects.get()
    assert saved.bot_token != NEW
    assert secrets.decrypt(saved.bot_token) == NEW
    # The environment's bot stops sending here; the new one starts.
    assert ("123:abc", "deleteWebhook") in fake_bot.as_bot
    assert webhooks(fake_bot) == [HOOK]
    assert bot.config().token == NEW
    # People connect to the new bot.
    assert api.get("/api/telegram/").json()["bot_username"] == "new_bot"
    assert "t.me/new_bot?start=" in api.post("/api/telegram/connect/").json()["url"]


def test_a_wrong_token_is_not_saved(admin, fake_bot):
    response = put(admin, "999:wrong")

    assert response.status_code == 400
    assert "bot_token" in response.json()
    assert not TelegramSettings.objects.exists()
    assert fake_bot.calls == []


def test_an_empty_token_is_refused(admin, fake_bot):
    assert put(admin, "  ").status_code == 400
    assert fake_bot.as_bot == []


def test_without_an_https_address_there_is_no_webhook(
    admin, fake_bot, settings, no_environment
):
    settings.TELEGRAM_WEBHOOK_URL = ""
    public_address.save("http://brain.example.com")
    fake_bot.bots[NEW] = "new_bot"

    data = put(admin, NEW).json()

    assert data["configured"] is True
    assert data["webhook_url"] == ""
    assert webhooks(fake_bot) == []

    # Saving the HTTPS address points the bot there.
    admin.put(
        "/api/server/address/",
        {"public_url": "https://brain.example.com"},
        content_type="application/json",
    )
    assert webhooks(fake_bot) == ["https://brain.example.com/api/telegram/webhook/"]


def test_removing_it_disconnects_the_bot(admin, fake_bot, no_environment):
    fake_bot.bots[NEW] = "new_bot"
    put(admin, NEW)
    fake_bot.calls.clear()

    data = admin.delete(URL).json()

    assert (NEW, "deleteWebhook") in fake_bot.as_bot
    assert not TelegramSettings.objects.exists()
    assert data["source"] == "environment"
    assert data["configured"] is False
    assert webhooks(fake_bot) == []


def test_removing_it_goes_back_to_the_environment_bot(admin, fake_bot):
    fake_bot.bots[NEW] = "new_bot"
    put(admin, NEW)
    fake_bot.calls.clear()

    data = admin.delete(URL).json()

    assert data["bot_username"] == "brainbro_bot"
    assert webhooks(fake_bot) == [HOOK]


def test_the_webhook_takes_the_saved_bot(client, db, user, fake_bot, no_environment):
    TelegramSettings.objects.create(
        bot_token=secrets.encrypt(NEW), bot_username="new_bot"
    )

    refused = client.post("/api/telegram/webhook/", {}, content_type="application/json")
    accepted = client.post(
        "/api/telegram/webhook/",
        {},
        content_type="application/json",
        headers={"X-Telegram-Bot-Api-Secret-Token": bot.webhook_secret()},
    )

    assert refused.status_code == 403
    assert accepted.status_code == 200
