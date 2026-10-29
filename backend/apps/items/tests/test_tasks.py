import io

import pytest
from celery.exceptions import Retry
from PIL import Image

from apps.items import tasks
from apps.items.models import Item
from apps.items.previews import Preview
from apps.items.safe_http import BlockedURL, TransientFetchError
from apps.items.tasks import fetch_link_preview


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def link(user):
    return Item.objects.create(
        owner=user,
        kind=Item.Kind.LINK,
        url="https://example.com/post",
        preview_status=Item.PreviewStatus.PENDING,
    )


def webp():
    output = io.BytesIO()
    Image.new("RGB", (10, 10)).save(output, format="WEBP")
    return output.getvalue()


def stub_preview(monkeypatch, metadata, image=None):
    preview = Preview(metadata=metadata, image_url="https://example.com/i.png")
    monkeypatch.setattr(tasks, "build_preview", lambda url: preview)
    monkeypatch.setattr(tasks, "download_preview_image", lambda url: image)


def test_stores_preview_and_local_image(monkeypatch, link, media):
    stub_preview(monkeypatch, {"title": "A post", "site_name": "Example"}, webp())
    fetch_link_preview(str(link.id))

    link.refresh_from_db()
    assert link.preview_status == Item.PreviewStatus.READY
    assert link.metadata == {"title": "A post", "site_name": "Example"}
    assert link.title == "A post"
    assert link.preview_image.name.startswith(f"previews/{link.id}/")
    assert (media / link.preview_image.name).read_bytes().startswith(b"RIFF")


def test_keeps_user_title_and_replaces_old_image(monkeypatch, link, media):
    stub_preview(monkeypatch, {"title": "First"}, webp())
    fetch_link_preview(str(link.id))
    link.refresh_from_db()
    old_image = media / link.preview_image.name

    Item.objects.filter(id=link.id).update(title="My title")
    stub_preview(monkeypatch, {"title": "Second"}, webp())
    fetch_link_preview(str(link.id))

    link.refresh_from_db()
    assert link.title == "My title"
    assert not old_image.exists()
    assert (media / link.preview_image.name).exists()


def test_preview_without_image_is_still_ready(monkeypatch, link):
    stub_preview(monkeypatch, {"title": "No image"}, None)
    fetch_link_preview(str(link.id))
    link.refresh_from_db()
    assert link.preview_status == Item.PreviewStatus.READY
    assert not link.preview_image


def test_final_errors_fail_without_retrying(monkeypatch, link):
    calls = []

    def blocked(url):
        calls.append(url)
        raise BlockedURL("private address")

    monkeypatch.setattr(tasks, "build_preview", blocked)
    fetch_link_preview.apply(args=[str(link.id)])

    link.refresh_from_db()
    assert len(calls) == 1
    assert link.preview_status == Item.PreviewStatus.FAILED
    assert link.metadata["preview_error"] == "private address"


def test_transient_errors_retry_with_backoff_then_fail(monkeypatch, link):
    def flaky(url):
        raise TransientFetchError("timeout")

    monkeypatch.setattr(tasks, "build_preview", flaky)
    for attempt, delay in enumerate(tasks.RETRY_DELAYS):
        with pytest.raises(Retry) as retry:
            fetch_link_preview.apply(args=[str(link.id)], retries=attempt)
        assert retry.value.when == delay
        link.refresh_from_db()
        assert link.preview_status == Item.PreviewStatus.PENDING

    fetch_link_preview.apply(args=[str(link.id)], retries=len(tasks.RETRY_DELAYS))
    link.refresh_from_db()
    assert link.preview_status == Item.PreviewStatus.FAILED


def test_transient_image_errors_retry_then_keep_preview(monkeypatch, link):
    def rate_limited(url):
        raise TransientFetchError("HTTP 429")

    monkeypatch.setattr(
        tasks, "build_preview", lambda url: Preview({"title": "T"}, "https://i.io/x")
    )
    monkeypatch.setattr(tasks, "download_preview_image", rate_limited)
    with pytest.raises(Retry):
        fetch_link_preview.apply(args=[str(link.id)], retries=0)
    link.refresh_from_db()
    assert link.preview_status == Item.PreviewStatus.PENDING

    fetch_link_preview.apply(args=[str(link.id)], retries=len(tasks.RETRY_DELAYS))
    link.refresh_from_db()
    assert link.preview_status == Item.PreviewStatus.READY
    assert not link.preview_image


def test_ignores_missing_and_non_link_items(monkeypatch, user):
    monkeypatch.setattr(tasks, "build_preview", pytest.fail)
    note = Item.objects.create(owner=user, kind=Item.Kind.NOTE, body="x")
    fetch_link_preview(str(note.id))
    fetch_link_preview("00000000-0000-0000-0000-000000000000")


def test_deleting_an_item_removes_its_image(monkeypatch, link, media):
    stub_preview(monkeypatch, {}, webp())
    fetch_link_preview(str(link.id))
    link.refresh_from_db()
    path = media / link.preview_image.name
    assert path.exists()

    link.delete()
    assert not path.exists()
