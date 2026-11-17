import io
import json
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.imports.models import Import
from apps.items.models import Item


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"


def zipped(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return SimpleUploadedFile("vault.zip", buffer.getvalue(), "application/zip")


def start(api, upload, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        return api.post("/api/imports/", {"file": upload}, format="multipart")


def test_a_vault_is_imported(api, user, django_capture_on_commit_callbacks):
    response = start(
        api, zipped({"Hello.md": "world"}), django_capture_on_commit_callbacks
    )

    assert response.status_code == 202
    assert response.json()["status"] == "pending"
    result = api.get(f"/api/imports/{response.json()['id']}/").json()
    assert result["status"] == "ready"
    assert result["filename"] == "vault.zip"
    assert result["counts"]["notes"] == 1
    assert Item.objects.get(owner=user).body == "world"
    assert Item.objects.get(owner=user).created_via == "import"
    # The zip is gone once read.
    assert not Import.objects.get().file


def test_a_failed_import_says_why(api, monkeypatch, django_capture_on_commit_callbacks):
    monkeypatch.setattr("apps.imports.vault.MAX_FILES", 1)

    response = start(
        api, zipped({"A.md": "a", "B.md": "b"}), django_capture_on_commit_callbacks
    )

    result = api.get(f"/api/imports/{response.json()['id']}/").json()
    assert result["status"] == "failed"
    assert "more than 1 files" in result["error"]
    assert not Item.objects.exists()


def test_one_at_a_time(api, user):
    Import.objects.create(owner=user)

    response = api.post(
        "/api/imports/", {"file": zipped({"A.md": "a"})}, format="multipart"
    )

    assert response.status_code == 409


def test_only_zips_up_to_the_limit(api, settings):
    not_zip = SimpleUploadedFile("vault.zip", b"hello", "application/zip")
    assert (
        api.post("/api/imports/", {"file": not_zip}, format="multipart").status_code
        == 400
    )

    settings.IMPORT_MAX_SIZE = 10
    response = api.post(
        "/api/imports/", {"file": zipped({"A.md": "a"})}, format="multipart"
    )
    assert response.status_code == 400
    assert "too large" in response.json()["file"][0]


def test_only_your_imports(api, other_user):
    theirs = Import.objects.create(owner=other_user)

    assert api.get("/api/imports/").json()["results"] == []
    assert api.get(f"/api/imports/{theirs.id}/").status_code == 404


def test_a_brainbro_export_is_told_apart(api, user, django_capture_on_commit_callbacks):
    files = {
        "brainbro-export-2026-11-17/items.json": json.dumps(
            {
                "export_version": 1,
                "items": [
                    {
                        "id": "6b1e0c2a-0000-4000-8000-000000000001",
                        "kind": "note",
                        "status": "archived",
                        "title": "Kept",
                        "body": "as it was",
                    }
                ],
            }
        ),
        "brainbro-export-2026-11-17/collections.json": "[]",
        "brainbro-export-2026-11-17/notes/Kept.md": "---\nid: x\n---\n",
    }

    response = start(api, zipped(files), django_capture_on_commit_callbacks)

    assert response.json()["source"] == "brainbro"
    result = api.get(f"/api/imports/{response.json()['id']}/").json()
    assert (result["status"], result["source"]) == ("ready", "brainbro")
    assert result["counts"]["notes"] == 1
    item = Item.objects.get(owner=user)
    assert (item.title, item.status, item.created_via) == (
        "Kept",
        "archived",
        "import",
    )


def test_a_vault_says_so(api, django_capture_on_commit_callbacks):
    response = start(api, zipped({"A.md": "a"}), django_capture_on_commit_callbacks)

    assert response.json()["source"] == "obsidian"
