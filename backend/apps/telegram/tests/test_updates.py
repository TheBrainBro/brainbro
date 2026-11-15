from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from apps.items.models import Item
from apps.telegram.models import TelegramLink
from apps.telegram.tasks import group_media, process_update, register_webhook
from apps.telegram.updates import handle_update

from .conftest import png

CHAT = {"id": 42, "type": "private"}


def update(update_id, **message):
    return {
        "update_id": update_id,
        "message": {"message_id": update_id * 10, "chat": CHAT, **message},
    }


def linked(user):
    return TelegramLink.objects.create(
        owner=user, chat_id=CHAT["id"], telegram_name="@me"
    )


def test_start_with_a_code_links_the_chat(user, fake_bot):
    TelegramLink.objects.create(
        owner=user, code="abc", code_expires_at=timezone.now() + timedelta(minutes=5)
    )

    handle_update(update(1, text="/start abc", **{"from": {"username": "alex"}}))

    link = TelegramLink.objects.get()
    assert (link.chat_id, link.telegram_name, link.code) == (42, "@alex", None)
    assert link.linked_at is not None
    assert "Connected to BrainBro" in fake_bot.sent("sendMessage")[0]["text"]


def test_expired_or_missing_codes_dont_link(user, fake_bot):
    TelegramLink.objects.create(
        owner=user, code="old", code_expires_at=timezone.now() - timedelta(minutes=1)
    )

    handle_update(update(1, text="/start old"))
    handle_update(update(2, text="/start"))

    assert TelegramLink.objects.get().chat_id is None
    assert all("open BrainBro" in m["text"] for m in fake_bot.sent("sendMessage"))


def test_each_user_links_their_own_chat(user, other_user, fake_bot):
    for owner, chat_id in [(user, 42), (other_user, 43)]:
        client = APIClient()
        client.force_authenticate(owner)
        url = client.post("/api/telegram/connect/").json()["url"]
        code = url.rsplit("start=", 1)[1]
        chat = {"id": chat_id, "type": "private"}
        handle_update(
            {"update_id": 1, "message": {"chat": chat, "text": f"/start {code}"}}
        )
        handle_update(
            {"update_id": 2, "message": {"chat": chat, "text": f"from {chat_id}"}}
        )

    assert Item.objects.get(owner=user).body == "from 42"
    assert Item.objects.get(owner=other_user).body == "from 43"
    links = TelegramLink.objects.order_by("chat_id")
    assert [link.owner for link in links] == [user, other_user]


def test_strangers_and_groups_are_ignored(user, fake_bot):
    handle_update(update(1, text="hello"))
    linked(user)
    handle_update(
        {"update_id": 2, "message": {"chat": {"id": 42, "type": "group"}, "text": "hi"}}
    )

    assert not Item.objects.exists()
    assert fake_bot.calls == []


def test_a_message_is_saved_once_with_a_thumbs_up(user, fake_bot):
    linked(user)

    handle_update(update(5, text="An idea"))
    handle_update(update(5, text="An idea"))

    assert Item.objects.get(owner=user).body == "An idea"
    assert fake_bot.sent("setMessageReaction") == [
        {
            "chat_id": 42,
            "message_id": 50,
            "reaction": [{"type": "emoji", "emoji": "👍"}],
        }
    ]


def test_what_cant_be_saved_gets_a_thumbs_down_and_a_reason(user, fake_bot):
    linked(user)

    handle_update(update(1, sticker={"file_id": "s"}))

    assert fake_bot.sent("setMessageReaction")[0]["reaction"][0]["emoji"] == "👎"
    answer = fake_bot.sent("sendMessage")[0]
    assert answer["text"] == "BrainBro can't keep this kind of message."
    assert answer["reply_parameters"]["message_id"] == 10


def test_album_photos_become_an_album_in_order(user, fake_bot):
    linked(user)
    fake_bot.files = {"a": png("red"), "b": png("blue")}

    def photo(update_id, message_id, file_id, **extra):
        data = update(
            update_id,
            photo=[{"file_id": file_id, "width": 4, "height": 4}],
            media_group_id="g1",
            **extra,
        )
        data["message"]["message_id"] = message_id
        return data

    # Saved out of order; the album follows the order they were sent in.
    process_update(photo(1, 20, "b"))
    process_update(photo(2, 10, "a", caption="Trip"))
    group_media(user.id, "g1")

    album = Item.objects.get(kind="album")
    assert [
        i.metadata["telegram_message_id"]
        for i in album.album_items.order_by("album_position")
    ] == [10, 20]
    assert album.body == "Trip"
    assert not Item.objects.filter(kind="image").exclude(body="").exists()

    # One that arrives late joins it.
    fake_bot.files["c"] = png("green")
    process_update(photo(3, 30, "c"))
    group_media(user.id, "g1")
    assert album.album_items.count() == 3
    assert Item.objects.filter(kind="album").count() == 1


def test_the_webhook_is_registered_with_its_secret(fake_bot):
    register_webhook()

    [params] = fake_bot.sent("setWebhook")
    assert params["url"] == "https://brainbro.example.com/api/telegram/webhook/"
    assert params["allowed_updates"] == ["message"]
    assert len(params["secret_token"]) == 64


def test_what_comes_from_telegram_says_so(user, fake_bot):
    linked(user)

    process_update(update(5, text="An idea"))

    item = Item.objects.get(owner=user)
    assert (item.created_by, item.created_via) == ("", "telegram")


def test_a_file_that_doesnt_fit_gets_a_thumbs_down_and_a_reason(
    settings, user, fake_bot
):
    settings.STORAGE_QUOTA = 10
    linked(user)
    fake_bot.files = {"a": png()}

    handle_update(update(1, photo=[{"file_id": "a", "width": 4, "height": 4}]))

    assert fake_bot.sent("setMessageReaction")[0]["reaction"][0]["emoji"] == "👎"
    answer = fake_bot.sent("sendMessage")[0]
    assert answer["text"].startswith("Not enough storage left")
    assert not Item.objects.exists()
