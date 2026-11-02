import io
import zipfile
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.exports.models import Export
from apps.exports.tasks import delete_old_exports
from apps.items.models import Item


@pytest.fixture(autouse=True)
def dirs(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    settings.EXPORT_DIR = tmp_path / "exports"


def start(api, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        return api.post("/api/exports/")


def test_an_export_is_built_and_downloaded(
    api, user, django_capture_on_commit_callbacks
):
    Item.objects.create(owner=user, kind="note", title="Hello", body="world")

    response = start(api, django_capture_on_commit_callbacks)

    assert response.status_code == 202
    assert response.json()["status"] == "pending"
    export = api.get(f"/api/exports/{response.json()['id']}/").json()
    assert export["status"] == "ready"
    assert export["size"] > 0
    assert export["filename"].startswith("brainbro-export-")
    assert api.get("/api/exports/").json()["results"][0]["id"] == export["id"]

    download = api.get(export["download_url"])
    assert download.status_code == 200
    assert download["Content-Type"] == "application/zip"
    assert export["filename"] in download["Content-Disposition"]
    archive = zipfile.ZipFile(io.BytesIO(b"".join(download.streaming_content)))
    assert any(name.endswith("/notes/Hello.md") for name in archive.namelist())


def test_a_new_export_replaces_the_last_one(
    api, user, django_capture_on_commit_callbacks
):
    first = Export.objects.get(
        id=start(api, django_capture_on_commit_callbacks).json()["id"]
    )
    assert first.path.exists()

    second = start(api, django_capture_on_commit_callbacks).json()

    assert second["id"] != str(first.id)
    assert not first.path.exists()
    assert list(Export.objects.values_list("status", flat=True)) == ["ready"]


def test_an_export_being_built_is_not_started_twice(api, user):
    pending = Export.objects.create(owner=user)

    response = api.post("/api/exports/")

    assert response.status_code == 200
    assert response.json()["id"] == str(pending.id)
    assert response.json()["download_url"] is None


def test_a_stuck_export_is_started_again(api, user):
    stuck = Export.objects.create(owner=user)
    Export.objects.filter(id=stuck.id).update(
        created_at=timezone.now() - timedelta(hours=3)
    )

    response = api.post("/api/exports/")

    assert response.status_code == 202
    assert response.json()["id"] != str(stuck.id)


def test_exports_are_private(api, other_user):
    theirs = Export.objects.create(owner=other_user, status="ready")

    assert api.get("/api/exports/").json()["results"] == []
    assert api.get(f"/api/exports/{theirs.id}/").status_code == 404
    assert api.get(f"/api/exports/{theirs.id}/download/").status_code == 404


def test_only_ready_exports_download(api, user):
    pending = Export.objects.create(owner=user)

    assert api.get(f"/api/exports/{pending.id}/download/").status_code == 404


def test_old_exports_are_deleted(user, settings):
    settings.EXPORT_DIR.mkdir(parents=True)
    old = Export.objects.create(owner=user, status="ready")
    old.path.write_bytes(b"zip")
    Export.objects.filter(id=old.id).update(
        created_at=timezone.now() - timedelta(hours=25)
    )
    recent = Export.objects.create(owner=user, status="ready")

    delete_old_exports()

    assert list(Export.objects.all()) == [recent]
    assert not old.path.exists()


def test_a_failed_build_is_marked(
    api, user, monkeypatch, django_capture_on_commit_callbacks
):
    def explode(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr("apps.exports.tasks.write_export", explode)

    export_id = start(api, django_capture_on_commit_callbacks).json()["id"]

    export = Export.objects.get(id=export_id)
    assert export.status == "failed"
    assert not list(export.path.parent.glob("*"))
