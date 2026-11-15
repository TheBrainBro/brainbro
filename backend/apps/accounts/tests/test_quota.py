import io
import zipfile

import pytest
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import Profile
from apps.accounts.quota import (
    QuotaExceeded,
    check_room,
    format_size,
    storage_quota,
    storage_used,
)
from apps.exports.models import Export
from apps.imports.models import Import
from apps.items.models import Collection, Item, NoteImage
from apps.public.models import Site

MB = 1024 * 1024


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    settings.EXPORT_DIR = tmp_path / "exports"


def png(name="photo.png", size=(4, 4)):
    output = io.BytesIO()
    Image.new("RGB", size, "red").save(output, format="PNG")
    return SimpleUploadedFile(name, output.getvalue(), content_type="image/png")


def stored_item(owner, size):
    item = Item(owner=owner, kind=Item.Kind.FILE)
    item.file.save("upload.bin", ContentFile(b"x" * size), save=False)
    item.save()
    return item


def test_every_file_of_the_user_counts(user, other_user):
    stored_item(user, 1000)
    image = NoteImage(owner=user, source=NoteImage.Source.PASTED, src="a.png")
    image.original.save("original.png", ContentFile(b"x" * 300), save=False)
    image.image.save("image.webp", ContentFile(b"x" * 200), save=False)
    image.save()
    profile = Profile.objects.create(user=user)
    profile.avatar.save("avatar.webp", ContentFile(b"x" * 50))
    stored_item(other_user, 5000)

    assert storage_used(user) == 1550


def test_exports_and_vault_zips_dont_count(user):
    vault = Import(owner=user, filename="vault.zip")
    vault.file.save("vault.zip", ContentFile(b"x" * 1000), save=False)
    vault.save()
    export = Export.objects.create(owner=user, status=Export.Status.READY, size=1000)
    export.path.parent.mkdir(parents=True, exist_ok=True)
    export.path.write_bytes(b"x" * 1000)

    assert storage_used(user) == 0


def test_a_file_already_gone_takes_no_room(user):
    item = stored_item(user, 1000)
    item.file.storage.delete(item.file.name)

    assert storage_used(user) == 0


def test_the_quota_is_the_servers_unless_the_profile_sets_one(settings, user):
    settings.STORAGE_QUOTA = None
    assert storage_quota(user) is None
    settings.STORAGE_QUOTA = 10
    assert storage_quota(user) == 10 * MB
    Profile.objects.create(user=user, storage_quota=1)
    assert storage_quota(user) == MB


def test_a_zero_quota_takes_nothing(settings, user):
    settings.STORAGE_QUOTA = 0

    with pytest.raises(QuotaExceeded):
        check_room(user, 1)


def test_no_quota_means_no_limit(settings, user):
    settings.STORAGE_QUOTA = None
    stored_item(user, 1000)

    check_room(user, 10**12)


def test_what_doesnt_fit_is_refused(settings, user):
    settings.STORAGE_QUOTA = 2
    stored_item(user, MB)

    check_room(user, MB)
    with pytest.raises(QuotaExceeded):
        check_room(user, MB + 1)
    # Replacing a file frees its room.
    check_room(user, 2 * MB, freed=MB)


@pytest.mark.parametrize(
    "size,text",
    [(0, "0 MB"), (3 * MB, "3 MB"), (1024 * MB, "1 GB"), (1536 * MB, "1.5 GB")],
)
def test_sizes_read_in_mb_or_gb(size, text):
    assert format_size(size) == text


def test_the_message_says_what_is_left(settings, user):
    settings.STORAGE_QUOTA = 10
    stored_item(user, 7 * MB)

    with pytest.raises(QuotaExceeded) as exc:
        check_room(user, 4 * MB)
    assert str(exc.value) == "Not enough storage left: 3 MB free of 10 MB."


# Where files come in


def test_capture_refuses_a_file_that_doesnt_fit(api, settings, user):
    settings.STORAGE_QUOTA = 1
    stored_item(user, MB)

    response = api.post("/api/items/capture/", {"file": png()}, format="multipart")

    assert response.status_code == 400
    assert "Not enough storage left" in response.json()["file"][0]
    assert Item.objects.filter(owner=user).count() == 1


def test_capture_takes_a_file_that_fits(api, settings):
    settings.STORAGE_QUOTA = 1

    response = api.post("/api/items/capture/", {"file": png()}, format="multipart")

    assert response.status_code == 201


def test_text_is_captured_with_the_storage_full(api, settings, user):
    settings.STORAGE_QUOTA = 1
    stored_item(user, MB)

    response = api.post("/api/items/capture/", {"text": "Buy milk"}, format="json")

    assert response.status_code == 201


def test_a_pasted_note_image_that_doesnt_fit_is_refused(api, settings, user):
    settings.STORAGE_QUOTA = 1
    stored_item(user, MB)

    response = api.post("/api/note-images/", {"file": png()}, format="multipart")

    assert response.status_code == 400
    assert "Not enough storage left" in response.json()["file"]
    assert not NoteImage.objects.exists()


def test_a_collection_image_that_doesnt_fit_is_refused(api, settings, user):
    settings.STORAGE_QUOTA = 1
    stored_item(user, MB)
    work = Collection.objects.create(owner=user, name="Work")

    response = api.post(
        f"/api/collections/{work.id}/image/",
        {"file": png(size=(400, 300))},
        format="multipart",
    )

    assert response.status_code == 400
    work.refresh_from_db()
    assert not work.image


def test_a_new_avatar_can_replace_one_at_the_limit(api, settings, user):
    assert (
        api.post(
            "/api/auth/profile/avatar/", {"file": png(size=(400, 300))}
        ).status_code
        == 200
    )
    settings.STORAGE_QUOTA = 1
    stored_item(user, MB - storage_used(user))

    # Same size as the one it replaces: it fits.
    response = api.post("/api/auth/profile/avatar/", {"file": png(size=(400, 300))})

    assert response.status_code == 200


def test_an_avatar_that_doesnt_fit_is_refused(api, settings, user):
    settings.STORAGE_QUOTA = 1
    stored_item(user, MB)

    response = api.post("/api/auth/profile/avatar/", {"file": png(size=(400, 300))})

    assert response.status_code == 400
    assert not Profile.objects.get(user=user).avatar


def test_a_blog_image_that_doesnt_fit_is_refused(api, settings, user):
    settings.STORAGE_QUOTA = 1
    stored_item(user, MB)
    blog = Site.objects.create(owner=user, hostname="alex.example")

    response = api.post(f"/api/sites/{blog.id}/avatar/", {"file": png(size=(400, 300))})

    assert response.status_code == 400
    blog.refresh_from_db()
    assert not blog.avatar


def test_an_import_is_refused_with_no_room_left(api, settings, user):
    settings.STORAGE_QUOTA = 1
    stored_item(user, MB)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("Note.md", "text")
    upload = SimpleUploadedFile("vault.zip", buffer.getvalue(), "application/zip")

    response = api.post("/api/imports/", {"file": upload}, format="multipart")

    assert response.status_code == 400
    assert "Not enough storage left" in response.json()["file"]
    assert not Import.objects.exists()


# What the app shows


def test_storage_says_what_is_used_and_the_quota(api, settings, user):
    settings.STORAGE_QUOTA = 10
    stored_item(user, 1000)

    assert api.get("/api/auth/storage/").json() == {"used": 1000, "quota": 10 * MB}


def test_storage_without_a_quota(api, settings):
    settings.STORAGE_QUOTA = None

    assert api.get("/api/auth/storage/").json() == {"used": 0, "quota": None}


def test_storage_needs_a_session():
    assert APIClient().get("/api/auth/storage/").status_code in (401, 403)
