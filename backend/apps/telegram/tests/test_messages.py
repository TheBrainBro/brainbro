import pytest

from apps.telegram import bot
from apps.telegram.messages import Unsupported, save_message

from .conftest import png


def test_text_becomes_a_note_and_a_lone_url_a_link(user, fake_bot):
    note = save_message(user, {"text": "Buy milk\nand eggs"})
    link = save_message(user, {"text": "https://example.com/a"})

    assert (note.kind, note.status, note.body) == (
        "note",
        "inbox",
        "Buy milk\nand eggs",
    )
    assert (link.kind, link.url, link.preview_status) == (
        "link",
        "https://example.com/a",
        "pending",
    )


def test_hidden_links_become_markdown_counting_utf16(user, fake_bot):
    # The emoji takes two UTF-16 code units, which entity offsets count.
    text = "🙂 Read this article (now)"
    entities = [
        {"type": "bold", "offset": 0, "length": 2},
        {"type": "text_link", "offset": 8, "length": 4, "url": "https://example.com/x"},
        {
            "type": "text_link",
            "offset": 13,
            "length": 7,
            "url": "https://example.com/a b",
        },
    ]

    note = save_message(user, {"text": text, "entities": entities})

    assert note.body == (
        "🙂 Read [this](https://example.com/x) "
        "[article](<https://example.com/a b>) (now)"
    )


def test_the_largest_photo_with_its_caption(user, fake_bot):
    fake_bot.files = {"big": png(), "small": b"nope"}
    photos = [
        {"file_id": "small", "width": 90, "height": 90},
        {"file_id": "big", "width": 1280, "height": 960},
    ]

    image = save_message(user, {"photo": photos, "caption": "The beach"})

    assert (image.kind, image.body, image.preview_status) == (
        "image",
        "The beach",
        "pending",
    )
    assert image.file.read() == png()


def test_files_are_detected_by_content(user, fake_bot):
    fake_bot.files = {"doc": b"%PDF-1.4 x", "pic": png(), "voice": b"OggS\0data"}

    pdf = save_message(user, {"document": {"file_id": "doc", "file_name": "paper.pdf"}})
    sent_as_file = save_message(
        user, {"document": {"file_id": "pic", "file_name": "a.png"}}
    )
    voice = save_message(
        user, {"voice": {"file_id": "voice", "mime_type": "audio/ogg"}}
    )

    assert (pdf.kind, pdf.title) == ("file", "paper.pdf")
    assert sent_as_file.kind == "image"
    assert voice.metadata["filename"] == "voice message.oga"


def test_what_cant_be_kept(user, fake_bot):
    with pytest.raises(Unsupported):
        save_message(user, {"sticker": {"file_id": "s"}})
    with pytest.raises(bot.FileTooLarge):
        save_message(
            user, {"video": {"file_id": "v", "file_size": bot.MAX_DOWNLOAD + 1}}
        )


def test_album_photos_remember_their_group(user, fake_bot):
    fake_bot.files = {"p": png()}

    image = save_message(
        user,
        {
            "photo": [{"file_id": "p", "width": 4, "height": 4}],
            "media_group_id": "g1",
            "message_id": 7,
        },
    )

    assert image.metadata["telegram_media_group"] == "g1"
    assert image.metadata["telegram_message_id"] == 7
