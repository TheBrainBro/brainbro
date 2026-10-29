import json
import zipfile
from datetime import UTC, datetime

import pytest
from django.core.files.base import ContentFile

from apps.boards.models import Board
from apps.exports.archive import write_export
from apps.items.models import Collection, Item

NOW = datetime(2026, 10, 29, 12, 0, tzinfo=UTC)
ROOT = "brain-export-2026-10-29/"


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"


def upload(owner, kind, filename, content, mime, **fields):
    item = Item.objects.create(
        owner=owner,
        kind=kind,
        metadata={"filename": filename, "mime": mime, "size": len(content)},
        **fields,
    )
    item.file.save(filename, ContentFile(content))
    return item


def export(owner, tmp_path):
    target = tmp_path / "export.zip"
    write_export(owner, target, now=NOW)
    archive = zipfile.ZipFile(target)
    names = {name.removeprefix(ROOT) for name in archive.namelist()}
    assert all(name.startswith(ROOT) for name in archive.namelist())
    return archive, names


def read(archive, path):
    return archive.read(ROOT + path).decode()


def manifest(archive):
    return {
        item["id"]: item for item in json.loads(read(archive, "items.json"))["items"]
    }


def test_notes_are_markdown_named_after_their_title(user, tmp_path):
    home = Collection.objects.create(owner=user, name="Home")
    note = Item.objects.create(
        owner=user, kind="note", title="Shopping list", body="- milk", status="archived"
    )
    note.collections.add(home)
    Item.objects.create(owner=user, kind="note", title="shopping list", body="eggs")
    Item.objects.create(owner=user, kind="note", body="\n# What: now?\nmore")

    archive, names = export(user, tmp_path)

    assert {
        "notes/Shopping list.md",
        "notes/shopping list 2.md",
        "notes/What now.md",
    } <= names
    text = read(archive, "notes/Shopping list.md")
    assert text.startswith(f'---\nid: "{note.id}"\nkind: "note"\nstatus: "archived"\n')
    assert 'title: "Shopping list"\ncollections: ["Home"]\n' in text
    assert f"created: {note.created_at.isoformat()}\n" in text
    assert text.endswith("---\n\n- milk\n")
    entry = manifest(archive)[str(note.id)]
    assert entry["path"] == "notes/Shopping list.md"
    assert entry["collections"] == [str(home.id)]
    collections = json.loads(read(archive, "collections.json"))
    assert collections[0]["name"] == "Home"
    assert collections[0]["items"] == [str(note.id)]


def test_links_carry_their_preview(user, tmp_path):
    link = Item.objects.create(
        owner=user,
        kind="link",
        url="https://example.com/a",
        body="Read later",
        metadata={
            "title": "A page",
            "description": "About\nthings",
            "site_name": "Example",
        },
    )
    link.preview_image.save("p.webp", ContentFile(b"webp"))

    archive, names = export(user, tmp_path)

    assert {"links/A page.md", "links/previews/A page.webp"} <= names
    text = read(archive, "links/A page.md")
    assert 'url: "https://example.com/a"\nsite: "Example"\n' in text
    assert text.endswith(
        "[A page](https://example.com/a)\n\n![](previews/A%20page.webp)\n\n"
        "> About\n> things\n\nRead later\n"
    )
    assert (
        manifest(archive)[str(link.id)]["preview_path"] == "links/previews/A page.webp"
    )


def test_uploads_keep_their_original_bytes(user, tmp_path):
    photo = upload(user, "image", "IMG_1.jpeg", b"jpeg", "image/jpeg")
    named = upload(
        user, "file", "x.pdf", b"%PDF", "application/pdf", title="Invoice.pdf"
    )

    archive, names = export(user, tmp_path)

    assert archive.read(ROOT + "images/IMG_1.jpeg") == b"jpeg"
    assert archive.read(ROOT + "files/Invoice.pdf") == b"%PDF"
    assert (
        archive.getinfo(ROOT + "files/Invoice.pdf").compress_type == zipfile.ZIP_STORED
    )
    paths = {key: value["path"] for key, value in manifest(archive).items()}
    assert paths[str(photo.id)] == "images/IMG_1.jpeg"
    assert paths[str(named.id)] == "files/Invoice.pdf"


def test_a_missing_upload_is_skipped(user, tmp_path):
    photo = upload(user, "image", "a.png", b"png", "image/png")
    photo.file.storage.delete(photo.file.name)

    archive, names = export(user, tmp_path)

    assert not any(name.startswith("images/") for name in names)
    assert manifest(archive)[str(photo.id)]["path"] is None


def test_albums_are_folders_in_order(user, tmp_path):
    album = Item.objects.create(owner=user, kind="album", title="Trip", body="Lisbon")
    second = upload(
        user, "image", "b.png", b"b", "image/png", album=album, album_position=1
    )
    first = upload(
        user, "image", "a.png", b"a", "image/png", album=album, album_position=0
    )

    archive, names = export(user, tmp_path)

    assert {
        "albums/Trip/album.md",
        "albums/Trip/01 a.png",
        "albums/Trip/02 b.png",
    } <= names
    assert not any(name.startswith("images/") for name in names)
    assert read(archive, "albums/Trip/album.md").endswith(
        "Lisbon\n\n![a](01%20a.png)\n\n![b](02%20b.png)\n"
    )
    items = manifest(archive)
    assert items[str(first.id)]["album"] == str(album.id)
    assert (
        items[str(first.id)]["album_position"],
        items[str(second.id)]["album_position"],
    ) == (0, 1)


def test_boards_come_with_their_items_and_an_outline(user, tmp_path):
    note = Item.objects.create(owner=user, kind="note", title="Plan")
    link = Item.objects.create(
        owner=user, kind="link", url="https://example.com", title="Ref"
    )
    board = Board.objects.create(
        owner=user,
        title="Ideas",
        layout={
            "schema_version": 1,
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {
                    "id": "n1",
                    "type": "item",
                    "item": str(note.id),
                    "x": 0,
                    "y": 0,
                    "w": None,
                    "h": None,
                    "parent": None,
                },
                {
                    "id": "n2",
                    "type": "item",
                    "item": str(link.id),
                    "x": 10,
                    "y": 20,
                    "w": None,
                    "h": None,
                    "parent": "g1",
                },
                {
                    "id": "n3",
                    "type": "sticky",
                    "text": "Ask\nBob",
                    "color": "",
                    "x": 0,
                    "y": 0,
                    "w": None,
                    "h": None,
                    "parent": "g1",
                },
                {
                    "id": "n4",
                    "type": "item",
                    "item": "00000000-0000-0000-0000-000000000000",
                    "x": 0,
                    "y": 0,
                    "w": None,
                    "h": None,
                    "parent": None,
                },
                {
                    "id": "s1",
                    "type": "stroke",
                    "points": [[0, 0], [1, 1]],
                    "color": "",
                    "width": 2,
                    "x": 0,
                    "y": 0,
                    "w": 1,
                    "h": 1,
                    "parent": None,
                },
            ],
            "groups": [
                {
                    "id": "g1",
                    "title": "Research",
                    "color": "",
                    "x": 0,
                    "y": 100,
                    "w": 500,
                    "h": 500,
                    "parent": None,
                },
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "n1",
                    "target": "g1",
                    "label": "needs",
                    "arrow": "end",
                    "stroke": "solid",
                    "color": "",
                },
                {
                    "id": "e2",
                    "source": "n1",
                    "target": "n4",
                    "label": "",
                    "arrow": "end",
                    "stroke": "solid",
                    "color": "",
                },
            ],
        },
    )

    archive, names = export(user, tmp_path)

    data = json.loads(read(archive, "boards/Ideas.json"))
    assert data["id"] == str(board.id)
    # The node of an item that is gone is dropped, with its edge.
    assert [node["id"] for node in data["layout"]["nodes"]] == ["n1", "n2", "n3", "s1"]
    assert [edge["id"] for edge in data["layout"]["edges"]] == ["e1"]
    assert data["items"] == {
        str(note.id): {"kind": "note", "title": "Plan", "path": "notes/Plan.md"},
        str(link.id): {"kind": "link", "title": "Ref", "path": "links/Ref.md"},
    }
    outline = read(archive, "boards/Ideas.md")
    assert outline.endswith(
        "# Ideas\n\n"
        "- [Plan](../notes/Plan.md)\n\n"
        "## Research\n\n"
        "- Sticky note: Ask Bob\n"
        "- [Ref](../links/Ref.md)\n\n"
        "## Connections\n\n"
        "- Plan → Research: needs\n\n"
        "_1 pen drawing is only in Ideas.json._\n"
    )


def test_only_the_owners_data_and_the_readme(user, other_user, tmp_path):
    Item.objects.create(owner=other_user, kind="note", title="Secret")
    Board.objects.create(owner=other_user, title="Theirs")
    Collection.objects.create(owner=other_user, name="Theirs")

    archive, names = export(user, tmp_path)

    assert names == {"README.md", "items.json", "collections.json"}
    assert "# Brain export" in read(archive, "README.md")
    data = json.loads(read(archive, "items.json"))
    assert (data["export_version"], data["items"]) == (1, [])
    assert json.loads(read(archive, "collections.json")) == []
