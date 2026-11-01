import io
import wave
from pathlib import Path

import pytest
from django.core.files.base import ContentFile

from apps.items.audio import audio_type
from apps.items.ranges import requested_range
from apps.items.uploads import detect_mime

from .test_uploads import capture, rename

FILES = Path(__file__).parent / "files"


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


def sample(name):
    return (FILES / name).read_bytes()


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(8000)
        recording.writeframes(b"\0\0" * 800)
    return output.getvalue()


@pytest.mark.parametrize(
    ("name", "content", "mime"),
    [
        ("song.mp3", sample("voice.mp3"), "audio/mpeg"),
        ("voice.ogg", sample("voice.ogg"), "audio/ogg"),
        ("take.wav", wav_bytes(), "audio/wav"),
        # What browsers record in: containers libmagic calls video.
        ("Voice note.webm", sample("voice.webm"), "audio/webm"),
        ("Voice note.mp4", sample("voice.mp4"), "audio/mp4"),
    ],
)
def test_recordings_become_audio_items_named_after_the_file(
    api, name, content, mime, django_capture_on_commit_callbacks
):
    response = capture(api, name, content, django_capture_on_commit_callbacks)

    assert response.status_code == 201
    data = response.json()
    assert (data["kind"], data["title"]) == ("audio", name)
    assert data["metadata"]["mime"] == mime
    assert data["preview_status"] == ""


@pytest.mark.parametrize("name", ["clip.webm", "clip.mp4"])
def test_videos_stay_files(api, name):
    data = capture(api, name, sample(name)).json()
    assert data["kind"] == "file"
    assert data["metadata"]["mime"].startswith("video/")


@pytest.mark.parametrize(
    "content",
    [
        # A WebM header cut short, and an MP4 whose boxes claim to be tiny.
        sample("voice.webm")[:40],
        b"\0\0\0\x18ftypisom\0\0\0\0isomiso2\0\0\0\x04moov",
    ],
)
def test_broken_containers_are_not_audio(content):
    file = ContentFile(content, name="x")
    assert audio_type(file, detect_mime(file)) is None
    assert file.tell() == 0


def test_audio_is_a_download_players_can_ask_parts_of(api):
    content = sample("voice.mp3")
    data = capture(api, "song.mp3", content).json()

    whole = api.get(data["file_url"])
    assert whole.status_code == 200
    assert whole["Accept-Ranges"] == "bytes"
    assert whole["Content-Type"] == "audio/mpeg"
    assert whole["Content-Disposition"] == 'attachment; filename="song.mp3"'

    part = api.get(data["file_url"], HTTP_RANGE="bytes=10-19")
    assert part.status_code == 206
    assert part["Content-Range"] == f"bytes 10-19/{len(content)}"
    assert part["Content-Length"] == "10"
    assert part["Content-Type"] == "audio/mpeg"
    assert part["Content-Disposition"] == 'attachment; filename="song.mp3"'
    assert part["X-Content-Type-Options"] == "nosniff"
    assert "sandbox" in part["Content-Security-Policy"]
    assert b"".join(part.streaming_content) == content[10:20]

    past = api.get(data["file_url"], HTTP_RANGE=f"bytes={len(content)}-")
    assert past.status_code == 416
    assert past["Content-Range"] == f"bytes */{len(content)}"


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, None),
        ("bytes=0-1", (0, 1)),
        ("bytes=90-", (90, 99)),
        ("bytes=90-500", (90, 99)),
        ("bytes=-10", (90, 99)),
        ("bytes=-500", (0, 99)),
        # Several ranges, other units or nonsense: the whole file.
        ("bytes=0-1,5-6", None),
        ("items=0-1", None),
        ("bytes=-", None),
    ],
)
def test_requested_ranges(header, expected):
    assert requested_range(header, 100) == expected


@pytest.mark.parametrize("header", ["bytes=100-", "bytes=5-4", "bytes=-0"])
def test_unsatisfiable_ranges(header):
    with pytest.raises(ValueError):
        requested_range(header, 100)


def test_renaming_a_recording_changes_its_title(api):
    data = capture(api, "voice.ogg", sample("voice.ogg")).json()

    response = rename(api, data["id"], "Standup")

    assert response.status_code == 200
    assert response.json()["title"] == "Standup.ogg"


def test_audio_kept_as_files_becomes_audio(migrate_to, user):
    old = migrate_to(("items", "0014_item_origin"))
    Item = old.get_model("items", "Item")
    for name, mime in [
        ("a.oga", "audio/ogg"),
        ("b.wav", "audio/x-wav"),
        ("c.pdf", "application/pdf"),
    ]:
        Item.objects.create(
            owner_id=user.id, kind="file", title=name, metadata={"mime": mime}
        )

    new = migrate_to(("items", "0015_audio_items"))
    Item = new.get_model("items", "Item")
    kinds = {
        item.title: (item.kind, item.metadata["mime"]) for item in Item.objects.all()
    }
    assert kinds == {
        "a.oga": ("audio", "audio/ogg"),
        "b.wav": ("audio", "audio/wav"),
        "c.pdf": ("file", "application/pdf"),
    }
