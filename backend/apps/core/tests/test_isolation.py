"""
One user can't reach another's data through any endpoint: their things are
missing from every list, and asking for them by id answers 404, as if they
didn't exist (403 would tell that they do).
"""

import pytest
from django.core.files.base import ContentFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.boards.layout import empty_layout
from apps.boards.models import Board
from apps.exports.models import Export
from apps.history.models import Revision
from apps.imports.models import Import
from apps.items.models import Collection, Item, NoteImage, NoteLink
from apps.telegram.models import TelegramLink

SECRET = "their-secret"


@pytest.fixture(autouse=True)
def storage(settings, tmp_path, monkeypatch):
    settings.MEDIA_ROOT = tmp_path / "media"
    settings.EXPORT_DIR = tmp_path / "exports"
    settings.EXPORT_DIR.mkdir()
    # Link previews would go to the network.
    monkeypatch.setattr("apps.items.views.enqueue_preview", lambda item: None)


@pytest.fixture
def theirs(other_user):
    """One of everything, owned by someone else, with its files."""
    owner = other_user
    collection = Collection.objects.create(owner=owner, name=SECRET)
    collection.image.save("image.webp", ContentFile(b"img"))
    note = Item.objects.create(
        owner=owner, kind=Item.Kind.NOTE, title=SECRET, body=SECRET
    )
    note.collections.add(collection)
    link = Item.objects.create(
        owner=owner, kind=Item.Kind.LINK, url="https://example.com", title=SECRET
    )
    link.preview_image.save("preview.webp", ContentFile(b"img"))
    upload = Item(owner=owner, kind=Item.Kind.FILE, title=SECRET)
    upload.file.save("upload.pdf", ContentFile(b"%PDF"))
    images = [
        Item.objects.create(owner=owner, kind=Item.Kind.IMAGE, title=SECRET)
        for _ in range(2)
    ]
    album = Item.objects.create(owner=owner, kind=Item.Kind.ALBUM, title=SECRET)
    Item.objects.filter(id__in=[image.id for image in images]).update(album=album)
    note_image = NoteImage.objects.create(
        owner=owner, note=note, source=NoteImage.Source.REMOTE, src="https://x/a.png"
    )
    note_image.image.save("image.webp", ContentFile(b"img"))
    note_link = NoteLink.objects.create(owner=owner, note=note, url="https://x/")
    note_link.image.save("image.webp", ContentFile(b"img"))
    board = Board.objects.create(owner=owner, title=SECRET)
    export = Export.objects.create(
        owner=owner, status=Export.Status.READY, finished_at=timezone.now()
    )
    export.path.write_bytes(b"zip")
    imported = Import.objects.create(owner=owner, filename=f"{SECRET}.zip")
    telegram = TelegramLink.objects.create(
        owner=owner, chat_id=42, telegram_name=SECRET
    )
    return {
        "collection": collection,
        "note": note,
        "link": link,
        "upload": upload,
        "image": images[0],
        "album": album,
        "note_image": note_image,
        "note_link": note_link,
        "board": board,
        "export": export,
        "import": imported,
        "telegram": telegram,
        "revision": note.revisions.get(),
        "board_revision": board.revisions.get(),
    }


@pytest.fixture
def mine(user):
    return {
        "note": Item.objects.create(owner=user, kind=Item.Kind.NOTE, body="mine"),
        "images": [
            Item.objects.create(owner=user, kind=Item.Kind.IMAGE) for _ in range(2)
        ],
        "board": Board.objects.create(owner=user, title="mine"),
    }


def snapshot(owner):
    """Everything `owner` has, to check nothing of theirs changed."""
    return {
        "items": sorted(
            Item.objects.filter(owner=owner).values_list(
                "id", "title", "body", "status", "album_id", "updated_at"
            )
        ),
        "placed": sorted(
            Item.collections.through.objects.filter(item__owner=owner).values_list(
                "item_id", "collection_id"
            )
        ),
        "collections": sorted(
            Collection.objects.filter(owner=owner).values_list(
                "id", "name", "parent_id", "image", "updated_at"
            )
        ),
        "boards": sorted(
            Board.objects.filter(owner=owner).values_list("id", "title", "revision")
        ),
        "note_images": NoteImage.objects.filter(owner=owner).count(),
        "note_links": NoteLink.objects.filter(owner=owner).count(),
        "exports": Export.objects.filter(owner=owner).count(),
        "imports": Import.objects.filter(owner=owner).count(),
        "telegram": list(
            TelegramLink.objects.filter(owner=owner).values_list("chat_id", "code")
        ),
        "revisions": sorted(
            Revision.objects.filter(owner=owner).values_list("id", "updated_at")
        ),
    }


LISTS = [
    "/api/items/",
    "/api/items/?status=inbox",
    "/api/items/?status=organized",
    "/api/items/?status=archived",
    f"/api/items/?q={SECRET}",
    "/api/items/?collection={collection}",
    f"/api/items/search/?q={SECRET}",
    "/api/collections/",
    "/api/boards/",
    "/api/exports/",
    "/api/imports/",
    "/api/graph/",
    "/api/telegram/",
    "/api/revisions/?item={note}",
    "/api/revisions/?board={board}",
]


@pytest.mark.parametrize("url", LISTS)
def test_their_things_are_in_no_list(api, theirs, url):
    response = api.get(url.format(**{name: obj.id for name, obj in theirs.items()}))

    assert response.status_code == 200
    content = response.content.decode()
    assert SECRET not in content
    for obj in theirs.values():
        assert str(obj.id) not in content


# Every endpoint that takes an id: reading, changing, deleting, and files.
BY_ID = [
    ("get", "/api/items/{note}/"),
    ("put", "/api/items/{note}/"),
    ("patch", "/api/items/{note}/"),
    ("delete", "/api/items/{note}/"),
    ("post", "/api/items/{note}/move/"),
    ("post", "/api/items/{link}/refresh-preview/"),
    ("get", "/api/items/{link}/preview-image/"),
    ("get", "/api/items/{upload}/file/"),
    ("put", "/api/items/{album}/album-items/"),
    ("post", "/api/items/{album}/ungroup/"),
    ("get", "/api/note-images/{note_image}/file/"),
    ("get", "/api/note-links/{note_link}/image/"),
    ("get", "/api/collections/{collection}/"),
    ("put", "/api/collections/{collection}/"),
    ("patch", "/api/collections/{collection}/"),
    ("delete", "/api/collections/{collection}/"),
    ("get", "/api/collections/{collection}/image/"),
    ("post", "/api/collections/{collection}/image/"),
    ("delete", "/api/collections/{collection}/image/"),
    ("get", "/api/boards/{board}/"),
    ("put", "/api/boards/{board}/"),
    ("patch", "/api/boards/{board}/"),
    ("delete", "/api/boards/{board}/"),
    ("put", "/api/boards/{board}/layout/"),
    ("get", "/api/exports/{export}/"),
    ("get", "/api/exports/{export}/download/"),
    ("get", "/api/imports/{import}/"),
    ("get", "/api/revisions/{revision}/"),
    ("post", "/api/revisions/{revision}/restore/"),
    ("post", "/api/revisions/{board_revision}/restore/"),
]


@pytest.mark.parametrize(("method", "url"), BY_ID)
def test_their_things_are_not_found(api, other_user, theirs, method, url):
    before = snapshot(other_user)
    url = url.format(**{name: obj.id for name, obj in theirs.items()})

    # Saving a board checks If-Match and the layout before looking it up.
    data = (
        empty_layout()
        if url.endswith("/layout/")
        else {"title": "mine now", "name": "mine now"}
    )
    response = getattr(api, method)(url, data, format="json", HTTP_IF_MATCH='"1"')

    assert response.status_code == 404
    assert snapshot(other_user) == before


@pytest.mark.parametrize(("method", "url"), BY_ID)
def test_nothing_is_open_without_signing_in(theirs, method, url):
    url = url.format(**{name: obj.id for name, obj in theirs.items()})
    assert getattr(APIClient(), method)(url).status_code == 403


@pytest.mark.parametrize("url", LISTS)
def test_no_list_is_open_without_signing_in(theirs, url):
    url = url.format(**{name: obj.id for name, obj in theirs.items()})
    assert APIClient().get(url).status_code == 403


def test_their_files_are_not_served_directly(client, user, theirs):
    client.force_login(user)
    for obj, field in [
        (theirs["upload"], "file"),
        (theirs["link"], "preview_image"),
        (theirs["collection"], "image"),
        (theirs["note_image"], "image"),
        (theirs["note_link"], "image"),
    ]:
        assert client.get(f"/media/{getattr(obj, field).name}").status_code == 404


def their_ids(theirs, *names):
    return [str(theirs[name].id) for name in names]


# Changes to my own things that point at theirs.
REFERENCES = [
    ("post", "/api/items/capture/", {"text": "hi", "collection": "{collection}"}),
    ("patch", "/api/items/{my_note}/", {"collections": ["{collection}"]}),
    ("post", "/api/items/{my_note}/move/", {"collection": "{collection}"}),
    ("post", "/api/collections/", {"name": "mine", "parent": "{collection}"}),
    (
        "post",
        "/api/items/triage/",
        {"ids": ["{my_note}"], "action": "organize", "collections": ["{collection}"]},
    ),
]


@pytest.mark.parametrize(("method", "url", "data"), REFERENCES)
def test_my_things_can_t_point_at_theirs(
    api, other_user, theirs, mine, method, url, data
):
    before = snapshot(other_user)
    ids = {name: obj.id for name, obj in theirs.items()} | {"my_note": mine["note"].id}
    payload = {
        key: [v.format(**ids) for v in value]
        if isinstance(value, list)
        else value.format(**ids)
        for key, value in data.items()
    }

    response = getattr(api, method)(url.format(**ids), payload, format="json")

    assert response.status_code == 400
    assert snapshot(other_user) == before


@pytest.mark.parametrize("action", ["organize", "archive", "inbox", "delete"])
def test_triage_leaves_their_items_alone(api, other_user, theirs, mine, action):
    before = snapshot(other_user)
    ids = their_ids(theirs, "note", "link", "upload", "album")

    response = api.post(
        "/api/items/triage/",
        {"ids": ids, "action": action, "collections": []},
        format="json",
    )

    assert response.status_code in (200, 400)
    assert snapshot(other_user) == before


def test_albums_can_t_take_their_images(api, other_user, theirs, mine):
    before = snapshot(other_user)
    mixed = [str(mine["images"][0].id), str(theirs["image"].id)]

    response = api.post("/api/items/albums/", {"items": mixed}, format="json")

    assert response.status_code == 400
    assert not Item.objects.filter(owner=mine["note"].owner, kind="album").exists()
    assert snapshot(other_user) == before


def test_boards_drop_their_items(api, other_user, theirs, mine):
    before = snapshot(other_user)
    board = mine["board"]
    node = {"id": "a", "type": "item", "item": str(theirs["note"].id), "x": 0, "y": 0}

    response = api.put(
        f"/api/boards/{board.id}/layout/",
        {**empty_layout(), "nodes": [node]},
        format="json",
        HTTP_IF_MATCH=f'"{board.revision}"',
    )

    assert response.status_code == 200
    board.refresh_from_db()
    assert str(theirs["note"].id) not in str(board.layout)
    assert not board.items.exists()
    assert snapshot(other_user) == before


def test_disconnecting_telegram_leaves_theirs(api, other_user, theirs):
    before = snapshot(other_user)

    assert api.delete("/api/telegram/").status_code == 204
    api.post("/api/telegram/connect/")

    assert snapshot(other_user) == before
