import pytest
from django.core.files.base import ContentFile

from apps.items import views
from apps.items.models import Item


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


@pytest.fixture
def enqueued(monkeypatch):
    calls = []
    monkeypatch.setattr(views.fetch_link_preview, "delay", calls.append)
    return calls


def test_capturing_a_link_enqueues_its_preview_after_commit(
    api, enqueued, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = api.post(
            "/api/items/capture/", {"text": "https://example.com"}, format="json"
        )
    assert response.json()["preview_status"] == "pending"
    assert enqueued == [response.json()["id"]]


def test_capturing_a_note_enqueues_nothing(
    api, enqueued, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = api.post("/api/items/capture/", {"text": "hi"}, format="json")
    assert response.json()["preview_status"] == ""
    assert enqueued == []


def test_refresh_preview(api, user, enqueued, django_capture_on_commit_callbacks):
    link = Item.objects.create(
        owner=user, kind="link", url="https://a.io", preview_status="failed"
    )
    with django_capture_on_commit_callbacks(execute=True):
        response = api.post(f"/api/items/{link.id}/refresh-preview/")
    assert response.status_code == 200
    assert response.json()["preview_status"] == "pending"
    assert enqueued == [str(link.id)]


def test_refresh_preview_only_for_links(api, user):
    note = Item.objects.create(owner=user, kind="note", body="x")
    assert api.post(f"/api/items/{note.id}/refresh-preview/").status_code == 400


def test_preview_image_is_served_to_its_owner_only(api, user, other_user):
    link = Item.objects.create(owner=user, kind="link", url="https://a.io")
    link.preview_image.save("x.webp", ContentFile(b"RIFFdata"))

    url = api.get(f"/api/items/{link.id}/").json()["preview_image_url"]
    assert url.startswith(f"/api/items/{link.id}/preview-image/?v=")

    response = api.get(url)
    assert response.status_code == 200
    assert response["Content-Type"] == "image/webp"
    assert b"".join(response.streaming_content) == b"RIFFdata"

    api.force_authenticate(other_user)
    assert api.get(url).status_code == 404


def test_preview_image_missing(api, user):
    link = Item.objects.create(owner=user, kind="link", url="https://a.io")
    assert api.get(f"/api/items/{link.id}/").json()["preview_image_url"] is None
    assert api.get(f"/api/items/{link.id}/preview-image/").status_code == 404
