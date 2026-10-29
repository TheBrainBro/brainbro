import io
from datetime import timedelta

import pytest
from celery.exceptions import Retry
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image

from apps.items import tasks, views
from apps.items.models import Item, NoteImage
from apps.items.note_images import (
    MAX_IMAGES,
    image_sources,
    replace_image_sources,
    source_key,
)
from apps.items.safe_http import TransientFetchError
from apps.items.tasks import (
    delete_unused_note_images,
    fetch_note_images,
    make_note_image_display,
)


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def enqueued(monkeypatch):
    calls = []
    monkeypatch.setattr(views.fetch_note_images, "delay", calls.append)
    return calls


def image_bytes(fmt="PNG", size=(40, 20)):
    output = io.BytesIO()
    Image.new("RGB", size, "red").save(output, format=fmt)
    return output.getvalue()


def webp():
    return image_bytes("WEBP", (10, 10))


def note(user, body=""):
    return Item.objects.create(owner=user, kind=Item.Kind.NOTE, body=body)


def save(api, item, body, captured):
    with captured(execute=True):
        response = api.patch(f"/api/items/{item.id}/", {"body": body}, format="json")
    assert response.status_code == 200
    return response.json()


def paste(api, name="shot.png", content=None):
    upload = SimpleUploadedFile(name, content or image_bytes())
    return api.post("/api/note-images/", {"file": upload}, format="multipart")


# Reading the Markdown


def test_image_sources_in_order_without_repeats():
    body = (
        "![a](https://a.example/1.png) text ![b](https://b.example/2.png)\n\n"
        "- ![again](https://a.example/1.png)\n"
        "> ![quoted](attachments/x.png)\n\n"
        "| t |\n|---|\n| ![cell](https://c.example/3.png) |\n"
    )
    assert image_sources(body) == [
        "https://a.example/1.png",
        "https://b.example/2.png",
        "attachments/x.png",
        "https://c.example/3.png",
    ]


def test_image_sources_skip_code_and_links():
    body = (
        "`![inline](https://x.example/a.png)`\n\n"
        "```\n![fenced](https://x.example/b.png)\n```\n\n"
        "[a link](https://x.example/c.png)\n"
    )
    assert image_sources(body) == []


def test_image_sources_read_references_and_normalize():
    # The same keys the frontend's imageKey gives (lib/markdown.test.ts).
    body = (
        "![ref][logo] ![spaced](<https://x.example/a b.png>) "
        "![escaped](https://x.example/a\\_b.png)\n\n[logo]: https://x.example/l.png\n"
    )
    assert image_sources(body) == [
        "https://x.example/l.png",
        "https://x.example/a%20b.png",
        "https://x.example/a_b.png",
    ]
    assert source_key("<https://x.example/a b.png>") == "https://x.example/a%20b.png"
    assert source_key("https://x.example/a\\_b.png") == "https://x.example/a_b.png"


def test_replace_image_sources_only_touches_matching_images():
    body = (
        "![a](https://x.example/a.png) [link](https://x.example/a.png)\n"
        '![b](<https://x.example/b c.png> "title") ![c](https://x.example/c.png)\n'
    )
    paths = {
        "https://x.example/a.png": "images/n/01.webp",
        "https://x.example/b%20c.png": "images/n/02.webp",
    }
    assert replace_image_sources(body, paths) == (
        "![a](images/n/01.webp) [link](https://x.example/a.png)\n"
        '![b](images/n/02.webp "title") ![c](https://x.example/c.png)\n'
    )


# Remote images


def test_saving_a_note_queues_its_new_remote_images(
    api, user, enqueued, django_capture_on_commit_callbacks
):
    item = note(user)
    data = save(
        api,
        item,
        "![a](https://x.example/a.png) ![b](http://x.example/b.png) ![c](ftp://x/c.png)",
        django_capture_on_commit_callbacks,
    )
    assert enqueued == [str(item.id)]
    assert data["images"] == {
        "https://x.example/a.png": {"status": "pending", "url": None},
        "http://x.example/b.png": {"status": "pending", "url": None},
    }
    assert data["body"].startswith("![a](https://x.example/a.png)")


def test_known_images_are_not_fetched_again(
    api, user, enqueued, django_capture_on_commit_callbacks
):
    item = note(user)
    body = "![a](https://x.example/a.png)"
    save(api, item, body, django_capture_on_commit_callbacks)
    save(api, item, f"{body}\n\nmore text", django_capture_on_commit_callbacks)
    assert enqueued == [str(item.id)]
    assert NoteImage.objects.count() == 1


def test_removing_an_image_deletes_its_copy(
    api, user, media, enqueued, django_capture_on_commit_callbacks
):
    item = note(user)
    save(api, item, "![a](https://x.example/a.png)", django_capture_on_commit_callbacks)
    image = NoteImage.objects.get()
    image.image.save("copy.webp", ContentFile(webp()))
    stored = media / image.image.name

    data = save(api, item, "no image now", django_capture_on_commit_callbacks)

    assert data["images"] == {}
    assert not NoteImage.objects.exists()
    assert not stored.exists()


def test_only_the_first_images_are_kept(
    api, user, enqueued, django_capture_on_commit_callbacks
):
    item = note(user)
    body = " ".join(f"![{n}](https://x.example/{n}.png)" for n in range(MAX_IMAGES + 5))
    save(api, item, body, django_capture_on_commit_callbacks)
    assert NoteImage.objects.count() == MAX_IMAGES


def test_capturing_a_note_queues_its_images(
    api, enqueued, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = api.post(
            "/api/items/capture/",
            {"text": "![a](https://x.example/a.png)", "kind": "note"},
            format="json",
        )
    assert response.status_code == 201
    assert enqueued == [response.json()["id"]]


def test_other_items_have_no_images(api, user):
    link = Item.objects.create(
        owner=user, kind=Item.Kind.LINK, url="https://x.example", body="![a](b.png)"
    )
    assert api.get(f"/api/items/{link.id}/").json()["images"] is None


def test_fetch_stores_copies_and_marks_failures(monkeypatch, user, media):
    item = note(user)
    good = NoteImage.objects.create(
        owner=user, note=item, source="remote", src="https://x.example/good.png"
    )
    bad = NoteImage.objects.create(
        owner=user, note=item, source="remote", src="https://x.example/bad.png"
    )
    monkeypatch.setattr(
        tasks, "download_preview_image", lambda url: webp() if "good" in url else None
    )

    fetch_note_images(str(item.id))

    good.refresh_from_db()
    bad.refresh_from_db()
    assert good.status == "ready"
    assert good.image.name.startswith(f"note-images/{good.id}/")
    assert (media / good.image.name).read_bytes().startswith(b"RIFF")
    assert (bad.status, bad.image.name) == ("failed", "")


def test_fetch_retries_temporary_errors_then_fails(monkeypatch, user):
    item = note(user)
    image = NoteImage.objects.create(
        owner=user, note=item, source="remote", src="https://x.example/a.png"
    )

    def unavailable(url):
        raise TransientFetchError("503")

    monkeypatch.setattr(tasks, "download_preview_image", unavailable)
    with pytest.raises(Retry):
        fetch_note_images.apply(args=[str(item.id)], throw=True)
    image.refresh_from_db()
    assert image.status == "pending"

    monkeypatch.setattr(tasks.fetch_note_images, "max_retries", 0)
    fetch_note_images(str(item.id))
    image.refresh_from_db()
    assert image.status == "failed"


def test_a_copy_for_an_image_removed_meanwhile_is_not_kept(monkeypatch, user, media):
    item = note(user)
    image = NoteImage.objects.create(
        owner=user, note=item, source="remote", src="https://x.example/a.png"
    )

    def download_then_remove(url):
        NoteImage.objects.filter(id=image.id).delete()
        return webp()

    monkeypatch.setattr(tasks, "download_preview_image", download_then_remove)
    fetch_note_images(str(item.id))
    assert not [path for path in media.rglob("*") if path.is_file()]


# Pasted images


def test_pasting_uploads_an_image_unused_until_a_note_links_it(
    api, user, media, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = paste(api)
    assert response.status_code == 201
    data = response.json()
    image = NoteImage.objects.get()
    assert data["src"] == f"attachments/{image.id}.png"
    assert image.source == "pasted"
    assert image.note is None and image.unused_since is not None
    assert image.metadata["filename"] == "shot.png"
    assert image.original.name.endswith(".png")
    # The display copy is made in the background (eagerly here).
    image.refresh_from_db()
    assert image.status == "ready"
    assert (media / image.image.name).read_bytes().startswith(b"RIFF")
    assert not Item.objects.exists()


def test_a_saved_note_claims_and_lets_go_of_pasted_images(
    api, user, enqueued, django_capture_on_commit_callbacks
):
    src = paste(api).json()["src"]
    item = note(user)

    data = save(api, item, f"![shot]({src})", django_capture_on_commit_callbacks)
    image = NoteImage.objects.get()
    assert (image.note_id, image.unused_since) == (item.id, None)
    assert data["images"][src]["status"] in ("pending", "ready")
    assert enqueued == []

    save(api, item, "gone", django_capture_on_commit_callbacks)
    image.refresh_from_db()
    # Kept, so undo brings it back.
    assert image.note_id == item.id and image.unused_since is not None

    save(api, item, f"![shot]({src})", django_capture_on_commit_callbacks)
    image.refresh_from_db()
    assert image.unused_since is None


def test_a_pasted_image_moves_with_cut_and_paste(
    api, user, enqueued, django_capture_on_commit_callbacks
):
    src = paste(api).json()["src"]
    first, second = note(user), note(user)
    save(api, first, f"![x]({src})", django_capture_on_commit_callbacks)

    # Still linked from the first note: the second can't take it.
    save(api, second, f"![x]({src})", django_capture_on_commit_callbacks)
    assert NoteImage.objects.get().note_id == first.id

    save(api, first, "cut", django_capture_on_commit_callbacks)
    save(api, second, f"![x]({src}) ", django_capture_on_commit_callbacks)
    assert NoteImage.objects.get().note_id == second.id


def test_notes_never_claim_other_users_images(
    api, user, other_user, enqueued, django_capture_on_commit_callbacks
):
    theirs = NoteImage.objects.create(
        owner=other_user,
        source="pasted",
        src="attachments/00000000-0000-4000-8000-000000000000.png",
        unused_since=timezone.now(),
    )
    theirs.src = f"attachments/{theirs.id}.png"
    theirs.save()
    data = save(
        api, note(user), f"![x]({theirs.src})", django_capture_on_commit_callbacks
    )
    theirs.refresh_from_db()
    assert theirs.note is None
    assert data["images"] == {}


@pytest.mark.parametrize(
    "name, content, message",
    [
        ("doc.pdf", b"%PDF-1.4\n%%EOF\n", "Only images can go in a note."),
        ("x.svg", b'<svg xmlns="http://www.w3.org/2000/svg"/>', "Only images"),
    ],
)
def test_only_raster_images_can_be_pasted(api, name, content, message):
    response = paste(api, name, content)
    assert response.status_code == 400
    assert message in response.json()["file"][0]
    assert not NoteImage.objects.exists()


def test_pasted_images_have_a_size_limit(api, monkeypatch):
    monkeypatch.setattr(views, "MAX_PASTED_SIZE", 10)
    response = paste(api)
    assert response.status_code == 400
    assert "too large" in response.json()["file"][0]


def test_unreadable_pasted_images_fail(user, media):
    image = NoteImage.objects.create(owner=user, source="pasted", src="x")
    image.original.save("original.png", ContentFile(b"\x89PNG\r\n\x1a\nbroken"))
    make_note_image_display(str(image.id))
    image.refresh_from_db()
    assert image.status == "failed"


def test_unused_pasted_images_are_deleted_after_a_week(user, media):
    now = timezone.now()
    old = NoteImage.objects.create(
        owner=user, source="pasted", src="old", unused_since=now - timedelta(days=8)
    )
    old.original.save("original.png", ContentFile(image_bytes()))
    stored = media / old.original.name
    recent = NoteImage.objects.create(
        owner=user, source="pasted", src="recent", unused_since=now - timedelta(days=6)
    )
    used = NoteImage.objects.create(
        owner=user, note=note(user), source="pasted", src="used"
    )

    assert delete_unused_note_images() == 1
    assert set(NoteImage.objects.values_list("id", flat=True)) == {recent.id, used.id}
    assert not stored.exists()


# Serving and deleting


def test_copies_are_served_only_to_their_owner(api, user, other_user, media):
    image = NoteImage.objects.create(
        owner=user, note=note(user), source="remote", src="https://x.example/a.png"
    )
    image.image.save("copy.webp", ContentFile(webp()))
    url = f"/api/note-images/{image.id}/file/"

    response = api.get(url)
    assert response.status_code == 200
    assert response["Content-Type"] == "image/webp"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert "immutable" in response["Cache-Control"]

    api.force_authenticate(other_user)
    assert api.get(url).status_code == 404


def test_pending_images_have_no_file(api, user):
    image = NoteImage.objects.create(owner=user, source="pasted", src="x")
    assert api.get(f"/api/note-images/{image.id}/file/").status_code == 404


def test_deleting_a_note_deletes_its_images(api, user, media):
    item = note(user, "![a](https://x.example/a.png)")
    image = NoteImage.objects.create(
        owner=user, note=item, source="remote", src="https://x.example/a.png"
    )
    image.image.save("copy.webp", ContentFile(webp()))
    stored = media / image.image.name

    response = api.post(
        "/api/items/triage/", {"ids": [str(item.id)], "action": "delete"}, format="json"
    )

    assert response.status_code == 200
    assert not NoteImage.objects.exists()
    assert not stored.exists()


def test_saving_keeps_the_version_and_markdown(
    api, user, enqueued, django_capture_on_commit_callbacks
):
    item = note(user, "a")
    body = "![a](<https://x.example/a b.png>)\n"
    with django_capture_on_commit_callbacks(execute=True):
        response = api.patch(
            f"/api/items/{item.id}/",
            {"body": body},
            format="json",
            headers={"If-Match": f'"{item.version}"'},
        )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.body == body
    assert response.json()["version"] == item.version
    assert list(response.json()["images"]) == ["https://x.example/a%20b.png"]
