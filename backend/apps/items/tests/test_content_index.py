from datetime import timedelta

import pytest
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from apps.items import content_index
from apps.items.extractors import Batch, Passage
from apps.items.models import FileIndex, Item, ItemPassage
from apps.items.tasks import index_upload


def upload(user, filename="test.pdf", mime="application/pdf"):
    return Item.objects.create(
        kind=Item.Kind.FILE,
        owner=user,
        file=f"uploads/{filename}",
        metadata={"mime": mime},
    )


def expire(item):
    FileIndex.objects.filter(item=item).update(
        retry_at=timezone.now() - timedelta(seconds=1)
    )


def test_capture_queues_specific_file_after_commit(
    api, user, settings, tmp_path, django_capture_on_commit_callbacks
):
    settings.MEDIA_ROOT = tmp_path
    old = upload(user)
    with django_capture_on_commit_callbacks(execute=True):
        response = api.post(
            "/api/items/capture/",
            {"file": SimpleUploadedFile("draft.txt", b"Remember the apricot orchard.")},
            format="multipart",
        )
        assert response.status_code == 201
        item = Item.objects.get(pk=response.data["id"])
        assert not item.passages.exists()

    assert item.passages.get().text == "Remember the apricot orchard."
    assert not FileIndex.objects.filter(item=old).exists()
    assert index_upload(item.pk) == 0
    hits = api.get("/api/items/search/", {"q": "apricot orchard"}).json()
    assert hits[0]["item"]["id"] == str(item.id)


def test_sweep_takes_bounded_batch_skipping_unsupported_files(user, monkeypatch):
    monkeypatch.setattr(content_index, "BACKFILL_FILES", 2)
    old, middle, new = [
        upload(user, f"{name}.pdf") for name in ("old", "middle", "new")
    ]
    unsupported = upload(user, "other.zip", "application/zip")
    paths = []

    def read(path, mime, cursor):
        paths.append(path.name)
        yield Batch(1, [Passage(path.name, page=1)])

    monkeypatch.setattr(content_index.extractors, "extract_batches", read)
    assert index_upload() == 2
    assert paths == ["new.pdf", "old.pdf"]
    assert index_upload() == 1
    assert middle.passages.exists() and old.passages.exists() and new.passages.exists()
    assert not FileIndex.objects.filter(item=unsupported).exists()
    assert index_upload() == 0


def test_retry_resumes_after_committed_and_blank_pages(api, user, monkeypatch):
    item = upload(user)
    calls = []

    def read(path, mime, cursor):
        calls.append(cursor)
        if cursor == 0:
            yield Batch(1, [Passage("first page", page=1)])
            yield Batch(2, [])
            raise TimeoutError("scan timed out reading page three")
        yield Batch(3, [Passage("third page", page=3)])

    monkeypatch.setattr(content_index.extractors, "extract_batches", read)
    assert index_upload() == 0
    assert FileIndex.objects.get(item=item).cursor == 2
    assert index_upload() == 0
    assert (
        api.get("/api/items/search/", {"q": "first page"}).json()[0]["matches"][0][
            "page"
        ]
        == 1
    )
    expire(item)
    assert index_upload() == 1
    assert calls == [0, 2]
    assert list(item.passages.order_by("position").values_list("position", "page")) == [
        (0, 1),
        (1, 3),
    ]


@pytest.mark.parametrize(
    ("char_limit", "row_limit", "expected"),
    [(5, 10, ["one", "tw"]), (100, 2, ["one", "two"])],
)
def test_audio_checkpoints_keep_totals_across_worker_slices(
    user, monkeypatch, char_limit, row_limit, expected
):
    item = upload(user, "talk.mp3", "audio/mpeg")
    starts = []

    def read(path, mime, cursor):
        starts.append(cursor)
        if cursor == 0:
            yield Batch(60, [Passage("one", start_seconds=10, end_seconds=11)])
        yield Batch(
            120,
            [
                Passage("two", start_seconds=61, end_seconds=62),
                Passage("three", start_seconds=65, end_seconds=66),
            ],
        )

    monkeypatch.setattr(content_index.extractors, "extract_batches", read)
    monkeypatch.setattr(content_index.extractors, "MAX_TEXT_CHARS", char_limit)
    monkeypatch.setattr(content_index.extractors, "MAX_PASSAGES", row_limit)
    monkeypatch.setattr(content_index, "SLICE_SECONDS", 0)
    assert index_upload(item.pk) == 0
    assert FileIndex.objects.get(item=item).cursor == 60
    assert index_upload(item.pk) == 1
    assert starts == [0, 60]
    assert (
        list(item.passages.order_by("position").values_list("text", flat=True))
        == expected
    )
    assert item.passages.get(position=1).start_seconds == 61


def test_unreadable_text_reaches_terminal_state(user, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    item = upload(user, "broken.txt", "text/plain")
    item.file.save("broken.txt", ContentFile(b"\xff\xfe\xf0"))
    assert index_upload() == 0
    index = FileIndex.objects.get(item=item)
    assert index.retry_at is None and index.attempts == 1
    assert index_upload() == 0
    assert not item.passages.exists()


def test_repeated_failure_at_same_cursor_stops_retrying(user, monkeypatch):
    item = upload(user)
    calls = []

    def read(path, mime, cursor):
        calls.append(cursor)
        if cursor == 0:
            yield Batch(1, [Passage("survives", page=1)])
        raise OSError("processing unavailable")

    monkeypatch.setattr(content_index.extractors, "extract_batches", read)
    for _ in range(content_index.MAX_ATTEMPTS):
        assert index_upload(item.pk) == 0
        index = FileIndex.objects.get(item=item)
        if index.retry_at is not None:
            expire(item)
    assert index.retry_at is None and index.cursor == 1
    assert index_upload(item.pk) == 0
    assert calls == [0, 1, 1]
    assert item.passages.get().text == "survives"


def test_crashed_workers_exhaust_retry_budget(user):
    item = upload(user)
    for attempt in range(content_index.MAX_ATTEMPTS):
        _, index = content_index._claim(item.pk, newest=True)
        assert index.attempts == attempt + 1
        expire(item)
    assert index_upload(item.pk) == 0
    assert FileIndex.objects.get(item=item).retry_at is None


def test_expired_claim_cannot_overwrite_newer_worker(user, monkeypatch):
    item = upload(user)

    def read(path, mime, cursor):
        if cursor == 0:
            yield Batch(1, [Passage("first")])
            expire(item)
            assert index_upload(item.pk) == 1
            yield Batch(2, [Passage("obsolete")])
        else:
            yield Batch(2, [Passage("new")])

    monkeypatch.setattr(content_index.extractors, "extract_batches", read)
    assert index_upload(item.pk) == 0
    assert list(item.passages.order_by("position").values_list("text", flat=True)) == [
        "first",
        "new",
    ]


def test_replacement_resets_old_checkpoints_and_deletion_drops_results(
    user, monkeypatch, settings, tmp_path
):
    settings.MEDIA_ROOT = tmp_path
    item = upload(user)
    seen = []

    def read(path, mime, cursor):
        seen.append((path.name, cursor))
        yield Batch(1, [Passage(path.name)])
        if path.name == "test.pdf":
            Item.objects.filter(pk=item.pk).update(file="uploads/new.pdf")
        else:
            item.delete()
        yield Batch(2, [Passage("stale")])

    monkeypatch.setattr(content_index.extractors, "extract_batches", read)
    pk = item.pk
    assert index_upload(pk) == 0
    assert index_upload(pk) == 0
    assert seen == [("test.pdf", 0), ("new.pdf", 0)]
    assert not ItemPassage.objects.exists()
    assert not FileIndex.objects.exists()
