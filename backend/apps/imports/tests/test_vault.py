import io
import json
import zipfile

import pytest
from PIL import Image

from apps.boards.models import Board
from apps.imports.vault import VaultError, import_vault
from apps.items.models import Collection, Item, NoteImage


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"


def png():
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(buffer, "PNG")
    return buffer.getvalue()


def vault(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    buffer.seek(0)
    return buffer


def test_folders_become_collections_and_the_top_goes_to_the_inbox(user):
    Collection.objects.create(owner=user, name="Work")

    counts = import_vault(
        user,
        vault(
            {
                "Loose.md": "at the top",
                "Work/Plan.md": "# Plan\n\nsteps",
                "Work/Clients/Acme.md": "client",
            }
        ),
    )

    assert counts["notes"] == 3 and counts["collections"] == 2
    loose = Item.objects.get(title="Loose")
    assert (loose.kind, loose.status, loose.body) == ("note", "inbox", "at the top")
    plan = Item.objects.get(title="Plan")
    assert plan.status == "organized"
    # The name was taken: the folder's collection is numbered.
    assert [c.name for c in plan.collections.all()] == ["Work 2"]
    clients = Item.objects.get(title="Acme").collections.get()
    assert (clients.name, clients.parent.name) == ("Clients", "Work 2")


def test_folders_named_alike_in_different_places_keep_their_names(user):
    import_vault(
        user,
        vault({"Work/Notes/a.md": "a", "Life/Notes/b.md": "b", "Life/notes/c.md": "c"}),
    )

    work = Item.objects.get(title="a").collections.get()
    life = Item.objects.get(title="b").collections.get()
    assert (work.name, work.parent.name) == ("Notes", "Work")
    assert (life.name, life.parent.name) == ("Notes", "Life")
    # Side by side they can't match, even in another case.
    assert Item.objects.get(title="c").collections.get().name == "notes 2"


def test_a_vault_zipped_as_its_folder_and_hidden_files(user):
    import_vault(
        user,
        vault(
            {
                "My vault/Idea.md": "x",
                "My vault/.obsidian/app.json": "{}",
                "My vault/.trash/Old.md": "gone",
                "__MACOSX/My vault/._Idea.md": "junk",
            }
        ),
    )

    assert list(Item.objects.values_list("title", "status")) == [("Idea", "inbox")]
    assert not Collection.objects.exists()


def test_embedded_images_belong_to_the_note(user):
    image = png()

    counts = import_vault(
        user,
        vault(
            {
                "Trip.md": (
                    "![[beach.png|300]] and ![[sun.png|The sun]]\n\n"
                    "![x](assets/beach.png)"
                ),
                "assets/beach.png": image,
                "assets/sun.png": image,
                "Photos/loose.png": image,
            }
        ),
    )

    note = Item.objects.get(kind="note")
    images = {i.metadata["filename"]: i for i in NoteImage.objects.filter(note=note)}
    assert set(images) == {"beach.png", "sun.png"}
    beach, sun = images["beach.png"].src, images["sun.png"].src
    assert note.body == f"![beach]({beach}) and ![The sun]({sun})\n\n![x]({beach})"
    assert all(i.source == "pasted" and i.unused_since is None for i in images.values())
    # Only the image no note shows is an item.
    assert counts["images"] == 1
    loose = Item.objects.get(kind="image")
    assert loose.metadata["filename"] == "loose.png"
    assert loose.collections.get().name == "Photos"
    # Nothing but the images was in assets/, so it isn't a collection.
    assert not Collection.objects.filter(name="assets").exists()


def test_other_files_and_missing_images(user):
    counts = import_vault(
        user,
        vault(
            {"Read.md": "![[paper.pdf]] ![[nowhere.png]]", "paper.pdf": b"%PDF-1.4 x"}
        ),
    )

    assert counts["files"] == 1
    assert Item.objects.get(kind="file").metadata["filename"] == "paper.pdf"
    assert Item.objects.get(kind="note").body == "![[paper.pdf]] ![[nowhere.png]]"


def test_properties_become_a_code_block(user):
    import_vault(
        user,
        vault(
            {
                "Obsidian.md": "---\ntags: [a, b]\n---\nBody",
                "Brain.md": '---\nid: "1"\nkind: "note"\n---\n\nBody',
            }
        ),
    )

    assert (
        Item.objects.get(title="Obsidian").body == "```yaml\ntags: [a, b]\n```\n\nBody"
    )
    assert Item.objects.get(title="Brain").body == "Body"


def test_canvases_become_boards(user):
    canvas = {
        "nodes": [
            {
                "id": "n1",
                "type": "file",
                "file": "Ideas/Plan.md",
                "x": 0,
                "y": 0,
                "width": 200,
                "height": 100,
            },
            {
                "id": "n2",
                "type": "file",
                "file": "pic.png",
                "x": 300,
                "y": 0,
                "width": 200,
                "height": 100,
            },
            {
                "id": "n3",
                "type": "link",
                "url": "https://example.com",
                "x": 0,
                "y": 300,
                "width": 200,
                "height": 100,
            },
            {
                "id": "n4",
                "type": "text",
                "text": "hello",
                "x": 300,
                "y": 300,
                "width": 200,
                "height": 100,
            },
        ],
        "edges": [{"id": "e1", "fromNode": "n1", "toNode": "n3"}],
    }

    counts = import_vault(
        user,
        vault(
            {
                "Ideas/Plan.md": "![[pic.png]]",
                "pic.png": png(),
                "Ideas/Map.canvas": json.dumps(canvas),
            }
        ),
    )

    assert (counts["boards"], counts["links"], counts["images"]) == (1, 1, 1)
    board = Board.objects.get()
    assert board.title == "Map"
    types = [n["type"] for n in board.layout["nodes"]]
    assert types == ["item", "item", "item", "sticky"]
    link = Item.objects.get(kind="link")
    assert link.url == "https://example.com"
    assert link.collections.get().name == "Ideas"
    # On a board, the image leaves the inbox; the note still shows it too.
    image = Item.objects.get(kind="image")
    assert image.status == "organized"
    assert set(board.items.all()) == {Item.objects.get(kind="note"), image, link}
    assert NoteImage.objects.count() == 1


def test_bad_canvases_and_large_notes_are_skipped(user, monkeypatch):
    monkeypatch.setattr("apps.imports.vault.MAX_NOTE_SIZE", 10)

    counts = import_vault(
        user, vault({"Broken.canvas": "{nope", "Long.md": "x" * 11, "Ok.md": "fine"})
    )

    assert counts["skipped"] == 2
    assert list(Item.objects.values_list("title", flat=True)) == ["Ok"]


def test_a_vault_too_large_unzipped_is_refused(user, settings):
    settings.IMPORT_MAX_SIZE = 10
    # 100 bytes of zeros zip to far less, but are stored as 100.
    archive = vault({"Notes/A.md": "a", "Big.bin": b"\0" * 100, "Small.md": "x"})

    with pytest.raises(VaultError, match="once unzipped"):
        import_vault(user, archive)
    assert not Item.objects.exists()


def test_hidden_files_don_t_count_unzipped(user, settings):
    settings.IMPORT_MAX_SIZE = 10
    archive = vault({".obsidian/cache": b"\0" * 1000, "A.md": "a"})

    import_vault(user, archive)
    assert Item.objects.count() == 1


def test_not_a_zip(user):
    with pytest.raises(VaultError):
        import_vault(user, io.BytesIO(b"hello"))


def test_all_or_nothing(user, monkeypatch, tmp_path):
    def broken(*args):
        raise RuntimeError("boom")

    monkeypatch.setattr("apps.imports.vault._Importer._create_board", broken)

    with pytest.raises(RuntimeError):
        import_vault(user, vault({"A.md": "a", "pic.png": png(), "B.canvas": "{}"}))

    assert not Item.objects.exists()
    assert not any(path.is_file() for path in (tmp_path / "media").rglob("*"))
