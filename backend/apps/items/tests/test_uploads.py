import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.items.models import Collection, Item
from apps.items.tasks import generate_thumbnail


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


def image_bytes(fmt="PNG", size=(40, 20), exif=None):
    output = io.BytesIO()
    image = Image.new("RGB", size, "red")
    kwargs = {"exif": exif} if exif is not None else {}
    image.save(output, format=fmt, **kwargs)
    return output.getvalue()


PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n"
SVG = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def capture(api, name, content, captured=None):
    upload = SimpleUploadedFile(name, content, content_type="application/x-whatever")
    if captured is None:
        return api.post("/api/items/capture/", {"file": upload}, format="multipart")
    with captured(execute=True):
        return api.post("/api/items/capture/", {"file": upload}, format="multipart")


def stored_files(media):
    return sorted(
        p.relative_to(media).parts[0] for p in media.rglob("*") if p.is_file()
    )


def test_image_upload_becomes_an_image_with_a_thumbnail(
    api, media, django_capture_on_commit_callbacks
):
    response = capture(
        api, "Screenshot.png", image_bytes(), django_capture_on_commit_callbacks
    )
    assert response.status_code == 201
    data = response.json()
    assert data["kind"] == "image"
    assert data["title"] == ""
    assert data["metadata"] == {
        "filename": "Screenshot.png",
        "mime": "image/png",
        "size": len(image_bytes()),
        "width": 40,
        "height": 20,
    }
    assert data["file_url"].startswith(f"/api/items/{data['id']}/file/?v=")

    # Celery runs eagerly in tests, so the thumbnail is already there.
    item = api.get(f"/api/items/{data['id']}/").json()
    assert item["preview_status"] == "ready"
    thumbnail = api.get(item["preview_image_url"])
    assert thumbnail["Content-Type"] == "image/webp"
    assert stored_files(media) == ["previews", "uploads"]


def test_other_files_become_file_items_named_after_the_file(api):
    data = capture(api, "Invoice 2026.pdf", PDF).json()
    assert data["kind"] == "file"
    assert data["title"] == "Invoice 2026.pdf"
    assert data["preview_status"] == "pending"  # first-page thumbnail
    assert data["metadata"]["mime"] == "application/pdf"
    item = Item.objects.get(id=data["id"])
    assert item.file.name.startswith(f"uploads/{item.id}/")
    assert item.file.name.endswith(".pdf")


def test_the_real_type_wins_over_the_extension(api):
    disguised_image = capture(api, "notes.pdf", image_bytes()).json()
    assert disguised_image["kind"] == "image"
    assert Item.objects.get(id=disguised_image["id"]).file.name.endswith(".png")

    disguised_text = capture(api, "photo.png", b"just some text\n").json()
    assert disguised_text["kind"] == "file"
    assert disguised_text["metadata"]["mime"] == "text/plain"
    assert Item.objects.get(id=disguised_text["id"]).file.name.endswith(".txt")


def test_large_uploads_spooled_to_disk_work_too(api, settings):
    settings.FILE_UPLOAD_MAX_MEMORY_SIZE = 10
    data = capture(api, "pic.png", image_bytes()).json()
    assert data["kind"] == "image"
    with Item.objects.get(id=data["id"]).file.open("rb") as file:
        assert file.read() == image_bytes()


def test_svg_and_broken_images_are_files(api):
    assert capture(api, "logo.svg", SVG).json()["kind"] == "file"
    broken_png = image_bytes()[:40]
    assert capture(api, "cut.png", broken_png).json()["kind"] == "file"


def test_heic_photos_are_images(api, django_capture_on_commit_callbacks):
    data = capture(
        api, "IMG_0001.HEIC", image_bytes("HEIF"), django_capture_on_commit_callbacks
    ).json()
    assert data["kind"] == "image"
    assert data["metadata"]["mime"] == "image/heic"
    assert Item.objects.get(id=data["id"]).preview_status == "ready"


def test_filenames_are_cleaned(api):
    data = capture(api, "a\x00b.txt", b"hi").json()
    assert data["metadata"]["filename"] == "ab.txt"


def test_too_large_files_are_refused_and_not_stored(api, settings, media):
    settings.UPLOAD_MAX_SIZE = 10
    response = capture(api, "big.pdf", PDF)
    assert response.status_code == 400
    assert response.json() == {"file": ["The file is too large (max 0 MB)."]}
    assert not Item.objects.exists()
    assert stored_files(media) == []


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"text": "hi", "file": SimpleUploadedFile("a.txt", b"hi")},
        {"file": SimpleUploadedFile("empty.txt", b"")},
    ],
)
def test_capture_needs_exactly_one_non_empty_input(api, payload):
    response = api.post("/api/items/capture/", payload, format="multipart")
    assert response.status_code == 400
    assert not Item.objects.exists()


def test_text_still_captures_as_form_data(api):
    response = api.post(
        "/api/items/capture/", {"text": "https://a.io"}, format="multipart"
    )
    assert response.json()["kind"] == "link"


def test_images_are_served_inline_to_their_owner_only(api, other_user):
    data = capture(api, "pic.png", image_bytes()).json()
    response = api.get(data["file_url"])
    assert response.status_code == 200
    assert response["Content-Type"] == "image/png"
    assert response["Content-Disposition"].startswith("inline")
    assert response["X-Content-Type-Options"] == "nosniff"
    assert b"".join(response.streaming_content) == image_bytes()

    api.force_authenticate(other_user)
    assert api.get(data["file_url"]).status_code == 404


@pytest.mark.parametrize(
    ("name", "content", "mime"),
    [("Invoice.pdf", PDF, "application/pdf"), ("logo.svg", SVG, "image/svg+xml")],
)
def test_other_files_are_downloads(api, name, content, mime):
    data = capture(api, name, content).json()
    response = api.get(data["file_url"])
    assert response["Content-Type"] == mime
    assert response["Content-Disposition"] == f'attachment; filename="{name}"'
    assert "sandbox" in response["Content-Security-Policy"]


def test_notes_have_no_file(api, user):
    note = Item.objects.create(owner=user, kind="note", body="x")
    assert api.get(f"/api/items/{note.id}/").json()["file_url"] is None
    assert api.get(f"/api/items/{note.id}/file/").status_code == 404


def test_thumbnails_follow_exif_orientation(api, django_capture_on_commit_callbacks):
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° clockwise
    content = image_bytes("JPEG", size=(40, 20), exif=exif)
    data = capture(api, "photo.jpg", content, django_capture_on_commit_callbacks)
    item = Item.objects.get(id=data.json()["id"])
    with Image.open(item.preview_image) as thumbnail:
        assert thumbnail.size == (20, 40)


def test_unreadable_images_fail_their_thumbnail(api, user):
    data = capture(api, "pic.png", image_bytes()).json()
    item = Item.objects.get(id=data["id"])
    with item.file.open("wb") as file:
        file.write(b"garbage")
    generate_thumbnail(str(item.id))
    item.refresh_from_db()
    assert item.preview_status == "failed"
    assert not item.preview_image


def test_refresh_preview_regenerates_image_thumbnails(
    api, django_capture_on_commit_callbacks
):
    data = capture(api, "pic.png", image_bytes(), django_capture_on_commit_callbacks)
    item_id = data.json()["id"]
    first = Item.objects.get(id=item_id).preview_image.name
    with django_capture_on_commit_callbacks(execute=True):
        api.post(f"/api/items/{item_id}/refresh-preview/")
    item = Item.objects.get(id=item_id)
    assert item.preview_status == "ready"
    assert item.preview_image.name != first


def test_deleting_an_upload_removes_its_files(
    api, media, django_capture_on_commit_callbacks
):
    data = capture(api, "pic.png", image_bytes(), django_capture_on_commit_callbacks)
    assert stored_files(media) == ["previews", "uploads"]
    api.post(
        "/api/items/triage/",
        {"ids": [data.json()["id"]], "action": "delete"},
        format="json",
    )
    assert stored_files(media) == []


def test_session_exposes_the_upload_limit(api, settings):
    settings.UPLOAD_MAX_SIZE = 1234
    assert api.get("/api/auth/session/").json()["limits"] == {"upload_max_size": 1234}


def pdf_bytes(size=(300, 400), pages=1):
    output = io.BytesIO()
    first, *rest = [Image.new("RGB", size, "white") for _ in range(pages)]
    first.save(output, format="PDF", save_all=True, append_images=rest)
    return output.getvalue()


def test_pdfs_get_their_first_page_as_thumbnail(
    api, django_capture_on_commit_callbacks
):
    data = capture(
        api, "Report.pdf", pdf_bytes(pages=3), django_capture_on_commit_callbacks
    ).json()
    assert data["kind"] == "file"
    item = Item.objects.get(id=data["id"])
    assert item.preview_status == "ready"
    with Image.open(item.preview_image) as thumbnail:
        assert thumbnail.format == "WEBP"
        width, height = thumbnail.size
        assert height > width  # portrait, like the page
        assert max(width, height) <= 1200
    assert api.get(f"/api/items/{item.id}/").json()["preview_image_url"]


def test_broken_pdfs_fail_their_thumbnail_but_stay_files(
    api, django_capture_on_commit_callbacks
):
    data = capture(api, "cut.pdf", PDF, django_capture_on_commit_callbacks).json()
    item = Item.objects.get(id=data["id"])
    assert item.kind == "file"
    assert item.preview_status == "failed"
    assert not item.preview_image


def test_other_files_have_no_thumbnail(api, django_capture_on_commit_callbacks):
    data = capture(api, "notes.txt", b"hello\n", django_capture_on_commit_callbacks)
    item_id = data.json()["id"]
    assert data.json()["preview_status"] == ""
    assert api.post(f"/api/items/{item_id}/refresh-preview/").status_code == 400


def test_refresh_preview_regenerates_pdf_thumbnails(
    api, django_capture_on_commit_callbacks
):
    data = capture(api, "a.pdf", pdf_bytes(), django_capture_on_commit_callbacks)
    item_id = data.json()["id"]
    first = Item.objects.get(id=item_id).preview_image.name
    with django_capture_on_commit_callbacks(execute=True):
        response = api.post(f"/api/items/{item_id}/refresh-preview/")
    assert response.status_code == 200
    assert Item.objects.get(id=item_id).preview_image.name != first


def test_upload_into_a_collection_organizes_it(api, user, media):
    collection = Collection.objects.create(owner=user, name="Docs")
    upload = SimpleUploadedFile("a.pdf", PDF, content_type="application/pdf")
    response = api.post(
        "/api/items/capture/",
        {"file": upload, "collection": str(collection.id)},
        format="multipart",
    )
    assert response.status_code == 201
    assert response.json()["status"] == "organized"
    assert list(collection.items.values_list("kind", flat=True)) == ["file"]
