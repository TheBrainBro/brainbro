import io

import pytest
from celery.exceptions import Retry
from PIL import Image

from apps.items import tasks
from apps.items.models import Item, NoteLink
from apps.items.note_links import previewed_links
from apps.items.previews import Preview
from apps.items.safe_http import FetchError, TransientFetchError
from apps.items.tasks import fetch_note_links


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def enqueued(monkeypatch):
    calls = []
    monkeypatch.setattr(tasks.fetch_note_links, "delay", calls.append)
    return calls


def webp():
    output = io.BytesIO()
    Image.new("RGB", (10, 10), "red").save(output, format="WEBP")
    return output.getvalue()


def note(user, body=""):
    return Item.objects.create(owner=user, kind=Item.Kind.NOTE, body=body)


def save(api, item, body, captured):
    with captured(execute=True):
        response = api.patch(f"/api/items/{item.id}/", {"body": body}, format="json")
    assert response.status_code == 200
    return response.json()


def test_only_card_and_embed_links_get_previews():
    body = (
        '[Video](https://youtu.be/abc "embed")\n\n'
        '[Post](https://blog.example/a "card")\n\n'
        "[Plain](https://plain.example) and https://bare.example\n\n"
        '[Titled](https://titled.example "Some title")\n\n'
        '[Again](https://blog.example/a "card")\n\n'
        '[Local](notes/a.md "card")\n'
    )
    assert previewed_links(body) == ["https://youtu.be/abc", "https://blog.example/a"]


def test_saving_a_note_adds_and_removes_link_previews(
    api, user, enqueued, django_capture_on_commit_callbacks
):
    item = note(user)
    data = save(
        api,
        item,
        '[Post](https://blog.example/a "card")',
        django_capture_on_commit_callbacks,
    )
    assert data["links"] == {
        "https://blog.example/a": {
            "status": "pending",
            "title": "",
            "description": "",
            "site_name": "",
            "image_url": None,
        }
    }
    assert enqueued == [str(item.id)]

    data = save(api, item, "Just text", django_capture_on_commit_callbacks)
    assert data["links"] == {}
    assert not NoteLink.objects.exists()


def test_fetch_stores_previews_and_marks_failures(monkeypatch, user, media):
    item = note(user)
    good = NoteLink.objects.create(owner=user, note=item, url="https://good.example")
    bad = NoteLink.objects.create(owner=user, note=item, url="https://bad.example")

    def build(url):
        if "bad" in url:
            raise FetchError("404")
        return Preview(
            metadata={"title": "Good", "site_name": "Good site"},
            image_url="https://good.example/og.png",
        )

    monkeypatch.setattr(tasks, "build_preview", build)
    monkeypatch.setattr(tasks, "download_preview_image", lambda url: webp())

    fetch_note_links(str(item.id))

    good.refresh_from_db()
    bad.refresh_from_db()
    assert (good.status, good.metadata["title"]) == ("ready", "Good")
    assert (media / good.image.name).read_bytes().startswith(b"RIFF")
    assert bad.status == "failed"


def test_fetch_retries_temporary_errors_then_fails(monkeypatch, user):
    item = note(user)
    link = NoteLink.objects.create(owner=user, note=item, url="https://slow.example")

    def unavailable(url):
        raise TransientFetchError("503")

    monkeypatch.setattr(tasks, "build_preview", unavailable)
    with pytest.raises(Retry):
        fetch_note_links.apply(args=[str(item.id)], throw=True)
    link.refresh_from_db()
    assert link.status == "pending"

    monkeypatch.setattr(tasks.fetch_note_links, "max_retries", 0)
    fetch_note_links(str(item.id))
    link.refresh_from_db()
    assert link.status == "failed"


def test_preview_image_is_served_only_to_its_owner(api, user, other_user, media):
    item = note(user)
    link = NoteLink.objects.create(
        owner=user, note=item, url="https://good.example", status="ready"
    )
    link.image.save("x.webp", io.BytesIO(webp()), save=True)

    url = api.get(f"/api/items/{item.id}/").json()["links"]["https://good.example"][
        "image_url"
    ]
    assert url.startswith(f"/api/note-links/{link.id}/image/?v=")
    response = api.get(url)
    assert response.status_code == 200
    assert response["Content-Type"] == "image/webp"

    theirs = note(other_user)
    other = NoteLink.objects.create(
        owner=other_user, note=theirs, url="https://x.example"
    )
    assert api.get(f"/api/note-links/{other.id}/image/").status_code == 404
