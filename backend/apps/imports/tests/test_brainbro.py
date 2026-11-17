import io
import json
import uuid
import zipfile
from datetime import UTC, datetime

import pytest
from django.core.files.base import ContentFile
from PIL import Image

from apps.boards.models import Board
from apps.exports.archive import write_export
from apps.imports.brainbro import Source, import_zip
from apps.imports.vault import VaultError
from apps.items.models import Collection, CollectionItem, Item, NoteImage

CREATED = datetime(2025, 3, 1, 9, 30, tzinfo=UTC)
UPDATED = datetime(2025, 3, 2, 18, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"


def picture(color="red", format="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), color).save(buffer, format)
    return buffer.getvalue()


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
    target = tmp_path / f"export-{uuid.uuid4().hex}.zip"
    write_export(owner, target)
    return target


def brain(owner):
    """A bit of everything an export has, dated in the past."""
    work = Collection.objects.create(
        owner=owner, name="Work", kind="project", color="#3b82f6", icon="🚀"
    )
    work.image.save("image.webp", ContentFile(picture("blue", "WEBP")), save=True)
    clients = Collection.objects.create(
        owner=owner, name="Clients", kind="area", parent=work
    )

    note = Item.objects.create(
        owner=owner, kind="note", status="organized", title="Plan", body="steps"
    )
    note.collections.add(clients)
    link = Item.objects.create(
        owner=owner,
        kind="link",
        status="archived",
        url="https://example.com/post",
        metadata={"title": "A post", "site_name": "Example"},
        preview_status="ready",
    )
    link.preview_image.save("p.webp", ContentFile(picture("green", "WEBP")))
    pdf = upload(owner, "file", "Report.pdf", b"%PDF-1.4 report", "application/pdf")
    album = Item.objects.create(owner=owner, kind="album", title="Trip")
    second = upload(
        owner,
        "image",
        "b.png",
        picture("black"),
        "image/png",
        album=album,
        album_position=1,
    )
    first = upload(
        owner,
        "image",
        "a.png",
        picture("white"),
        "image/png",
        album=album,
        album_position=0,
    )
    Item.objects.filter(owner=owner).update(created_at=CREATED, updated_at=UPDATED)

    board = Board.objects.create(
        owner=owner,
        title="Ideas",
        layout={
            "schema_version": 1,
            "viewport": {"x": 5, "y": 6, "zoom": 2},
            "nodes": [
                {
                    "id": "n1",
                    "type": "item",
                    "item": str(note.id),
                    "x": 0,
                    "y": 0,
                    "w": None,
                    "h": None,
                    "parent": "g1",
                },
                {
                    "id": "n2",
                    "type": "item",
                    "item": str(link.id),
                    "x": 300,
                    "y": 0,
                    "w": 200,
                    "h": 120,
                    "parent": None,
                },
                {
                    "id": "s1",
                    "type": "stroke",
                    "points": [[0, 0], [10, 10]],
                    "color": "#ef4444",
                    "width": 3,
                    "x": 50,
                    "y": 50,
                    "w": 10,
                    "h": 10,
                    "parent": None,
                },
            ],
            "groups": [
                {
                    "id": "g1",
                    "title": "Now",
                    "color": "",
                    "x": -20,
                    "y": -20,
                    "w": 260,
                    "h": 200,
                    "parent": None,
                }
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "n1",
                    "target": "n2",
                    "label": "see",
                    "arrow": "both",
                    "stroke": "dashed",
                    "color": "",
                }
            ],
        },
    )
    board.items.set([note, link])
    return {
        "work": work,
        "clients": clients,
        "note": note,
        "link": link,
        "pdf": pdf,
        "album": album,
        "first": first,
        "second": second,
        "board": board,
    }


def test_a_round_trip_keeps_everything(user, other_user, tmp_path):
    before = brain(user)

    with open(export(user, tmp_path), "rb") as source:
        kind, counts = import_zip(other_user, source)

    assert kind == Source.BRAINBRO
    assert counts == {
        "notes": 1,
        "images": 2,
        "files": 1,
        "links": 1,
        "albums": 1,
        "boards": 1,
        "collections": 2,
        "existing": 0,
        "skipped": 0,
    }
    # The ids are someone else's here: new ones, nothing of theirs touched.
    assert not Item.objects.filter(owner=other_user, id=before["note"].id).exists()
    assert Item.objects.filter(owner=user).count() == 6

    work = Collection.objects.get(owner=other_user, name="Work")
    assert (work.kind, work.color, work.icon, work.parent) == (
        "project",
        "#3b82f6",
        "🚀",
        None,
    )
    assert work.image and work.image.read() == before["work"].image.open().read()
    clients = Collection.objects.get(owner=other_user, name="Clients")
    assert (clients.kind, clients.parent) == ("area", work)

    note = Item.objects.get(owner=other_user, kind="note")
    assert (note.title, note.body, note.status) == ("Plan", "steps", "organized")
    assert list(note.collections.all()) == [clients]
    assert (note.created_at, note.updated_at) == (CREATED, UPDATED)
    assert note.inbox_rank == CREATED.timestamp()

    link = Item.objects.get(owner=other_user, kind="link")
    assert (link.url, link.status, link.preview_status) == (
        "https://example.com/post",
        "archived",
        "ready",
    )
    assert link.metadata == {"title": "A post", "site_name": "Example"}
    assert link.preview_image.read() == before["link"].preview_image.open().read()

    pdf = Item.objects.get(owner=other_user, kind="file")
    assert pdf.file.read() == b"%PDF-1.4 report"
    assert pdf.metadata["filename"] == "Report.pdf"

    album = Item.objects.get(owner=other_user, kind="album")
    images = list(album.album_items.order_by("album_position"))
    assert [i.metadata["filename"] for i in images] == ["a.png", "b.png"]
    assert [i.album_position for i in images] == [0, 1]
    assert images[0].file.read() == before["first"].file.open().read()

    board = Board.objects.get(owner=other_user)
    old = before["board"].layout
    assert board.title == "Ideas"
    assert board.layout["viewport"] == {"x": 5.0, "y": 6.0, "zoom": 2.0}
    nodes = {node["id"]: node for node in board.layout["nodes"]}
    assert nodes["n1"]["item"] == str(note.id)
    assert nodes["n2"]["item"] == str(link.id)
    assert (nodes["n1"]["w"], nodes["n1"]["parent"]) == (None, "g1")
    assert nodes["s1"]["points"] == [[0.0, 0.0], [10.0, 10.0]]
    assert board.layout["groups"][0]["title"] == old["groups"][0]["title"]
    assert board.layout["edges"][0]["stroke"] == "dashed"
    assert board.layout["edges"][0]["arrow"] == "both"
    assert set(board.items.all()) == {note, link}


def test_importing_the_same_export_twice_adds_nothing(user, tmp_path):
    brain(user)
    target = export(user, tmp_path)
    Item.objects.filter(owner=user, kind="note").delete()

    with open(target, "rb") as source:
        _, counts = import_zip(user, source)

    # Everything else was never gone: it's left as it is.
    assert counts["notes"] == 1
    assert counts["existing"] == 5 + 2 + 1  # items, collections, the board
    assert counts["collections"] == counts["boards"] == 0
    assert Item.objects.filter(owner=user).count() == 6
    assert Collection.objects.filter(owner=user).count() == 2

    with open(target, "rb") as source:
        _, again = import_zip(user, source)
    assert again["existing"] == 6 + 2 + 1
    assert Item.objects.filter(owner=user).count() == 6


def test_free_ids_are_kept(user, tmp_path):
    before = brain(user)
    target = export(user, tmp_path)
    Item.objects.filter(owner=user).delete()
    Board.objects.filter(owner=user).delete()
    Collection.objects.filter(owner=user).delete()

    with open(target, "rb") as source:
        import_zip(user, source)

    note = Item.objects.get(id=before["note"].id)
    assert list(note.collections.all()) == [
        Collection.objects.get(id=before["clients"].id)
    ]
    assert Board.objects.get(id=before["board"].id).layout["nodes"][0]["item"] == str(
        note.id
    )


def test_a_second_account_importing_twice_adds_nothing(user, other_user, tmp_path):
    brain(user)
    target = export(user, tmp_path)
    for _ in range(2):
        with open(target, "rb") as source:
            import_zip(other_user, source)

    assert Item.objects.filter(owner=other_user).count() == 6
    assert Board.objects.filter(owner=other_user).count() == 1


def test_collections_named_alike_are_merged(user, other_user, tmp_path):
    brain(user)
    work = Collection.objects.create(owner=other_user, name="work", color="#000000")

    with open(export(user, tmp_path), "rb") as source:
        _, counts = import_zip(other_user, source)

    # Into the one already there, which keeps its look; its children are new.
    assert counts["collections"] == 1
    work.refresh_from_db()
    assert (work.name, work.color, work.kind) == ("work", "#000000", "resource")
    assert Collection.objects.get(owner=other_user, name="Clients").parent == work


def test_note_images_come_back(user, other_user, tmp_path):
    note = Item.objects.create(owner=user, kind="note", title="Trip")
    pasted = NoteImage(owner=user, note=note, source="pasted")
    pasted.src = f"attachments/{pasted.id}.png"
    pasted.original.save("original.png", ContentFile(picture("red")), save=False)
    pasted.save()
    remote = NoteImage(
        owner=user,
        note=note,
        source="remote",
        src="https://x.example/a.png",
        status="ready",
    )
    remote.image.save("image.webp", ContentFile(picture("blue", "WEBP")), save=False)
    remote.save()
    note.body = f"![a](https://x.example/a.png)\n\n![p]({pasted.src})\n"
    note.save()

    with open(export(user, tmp_path), "rb") as source:
        import_zip(other_user, source)

    copy = Item.objects.get(owner=other_user)
    images = {image.source: image for image in copy.note_images.all()}
    # The pasted id is taken (by the original): the note points at its new one.
    assert images["pasted"].src != pasted.src
    assert (
        copy.body == f"![a](https://x.example/a.png)\n\n![p]({images['pasted'].src})\n"
    )
    assert images["pasted"].original.read() == picture("red")
    assert (images["remote"].src, images["remote"].status) == (
        "https://x.example/a.png",
        "ready",
    )
    assert images["remote"].image.read() == picture("blue", "WEBP")


def test_a_newer_export_is_refused(user, tmp_path):
    target = export(user, tmp_path)
    with zipfile.ZipFile(target) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    for name in files:
        if name.endswith("items.json"):
            manifest = json.loads(files[name])
            files[name] = json.dumps({**manifest, "export_version": 99})
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    buffer.seek(0)

    with pytest.raises(VaultError, match="newer version of BrainBro"):
        import_zip(user, buffer)


def test_items_missing_from_the_export_are_skipped(user, other_user, tmp_path):
    pdf = upload(user, "file", "a.pdf", b"%PDF-1.4", "application/pdf")
    pdf.file.storage.delete(pdf.file.name)  # gone from the disk: path is null

    with open(export(user, tmp_path), "rb") as source:
        _, counts = import_zip(other_user, source)

    assert counts["skipped"] == 1
    assert not Item.objects.filter(owner=other_user).exists()
    assert not CollectionItem.objects.exists()
