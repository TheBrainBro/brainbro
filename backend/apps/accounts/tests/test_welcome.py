import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from apps.accounts.models import Profile


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(
        username="carlos", password="s3cret-pass"
    )


@pytest.fixture
def client(user):
    client = Client()
    client.force_login(user)
    return client


def test_session_says_the_welcome_was_not_seen(client):
    assert client.get("/api/auth/session/").json()["welcome_seen"] is False


def test_marking_the_welcome_seen_holds_for_every_session(client, user):
    response = client.post("/api/auth/welcome/")
    assert response.status_code == 204

    other_device = Client()
    other_device.force_login(user)
    assert other_device.get("/api/auth/session/").json()["welcome_seen"] is True


def test_marking_it_again_keeps_the_first_time(client, user):
    client.post("/api/auth/welcome/")
    first = Profile.objects.get(user=user).welcome_seen_at

    client.post("/api/auth/welcome/")

    assert Profile.objects.get(user=user).welcome_seen_at == first


@pytest.mark.django_db
def test_marking_it_requires_a_session():
    assert Client().post("/api/auth/welcome/").status_code == 403


def test_sample_content_can_be_created_and_removed_without_touching_real_data(
    client, user
):
    from apps.boards.models import Board
    from apps.items.models import Collection, Item

    real = Item.objects.create(owner=user, kind="note", title="Mine", body="Keep this")
    payload = {"mcp_url": "https://brain.example.com/api/mcp"}
    response = client.post(
        "/api/auth/sample-content/", payload, content_type="application/json"
    )
    assert response.status_code == 204
    assert Item.objects.filter(owner=user, is_sample=True).count() == 8
    assert Collection.objects.filter(owner=user, is_sample=True).count() == 4
    inbox = client.get("/api/items/?status=inbox").json()["results"]
    assert [item["title"] for item in inbox[:4]] == [
        "Start here: your second brain",
        "From a quick capture to a clear plan",
        "Connect your AI",
        "How BrainBro works with AI",
    ]
    board = Board.objects.get(owner=user, is_sample=True)
    assert len(board.layout["nodes"]) == 5
    assert board.title == "From capture to clarity"
    assert (
        "private, self-hosted"
        in Item.objects.get(owner=user, title="Start here: your second brain").body
    )
    picture = Item.objects.get(owner=user, title="From a quick capture to a clear plan")
    assert picture.file and picture.preview_image
    assert picture.metadata["width"] == 1200
    assert picture.metadata["height"] == 720
    assert picture.preview_status == Item.PreviewStatus.READY
    from PIL import Image

    with Image.open(picture.preview_image) as thumbnail:
        assert thumbnail.width > 1 and thumbnail.height > 1
        assert thumbnail.convert("RGB").getbbox() is not None
    prompt = Item.objects.get(owner=user, title="Connect your AI")
    assert "https://brain.example.com/api/mcp" in prompt.body
    assert client.get("/api/auth/session/").json()["has_sample_content"] is True

    # A retry is safe and never makes a second starter.
    client.post("/api/auth/sample-content/", payload, content_type="application/json")
    assert Item.objects.filter(owner=user, is_sample=True).count() == 8

    response = client.delete("/api/auth/sample-content/")
    assert response.status_code == 204
    assert list(Item.objects.filter(owner=user)) == [real]
    assert not Collection.objects.filter(owner=user, is_sample=True).exists()
    assert not Board.objects.filter(owner=user, is_sample=True).exists()
    assert client.get("/api/auth/session/").json()["has_sample_content"] is False


def test_removing_samples_keeps_user_items_and_cleans_only_sample_board_nodes(
    client, user
):
    from apps.boards.layout import empty_layout
    from apps.boards.models import Board
    from apps.items.models import Collection, Item

    client.post(
        "/api/auth/sample-content/",
        {"mcp_url": "https://brain.example.com/api/mcp"},
        content_type="application/json",
    )
    sample_note = Item.objects.get(owner=user, title="Start here: your second brain")
    board = Board.objects.get(owner=user, is_sample=True)
    on_sample_board = Item.objects.create(
        owner=user, kind="note", body="Keep from board"
    )
    board.items.add(on_sample_board)
    board.layout["nodes"].append(
        {
            "id": "user-note",
            "type": "item",
            "item": str(on_sample_board.id),
            "x": 0,
            "y": 500,
            "w": 280,
            "h": None,
            "parent": None,
        }
    )
    board.save(update_fields=["layout", "updated_at"])

    real_board_note = Item.objects.create(owner=user, kind="note", body="Keep on board")
    normal_board = Board.objects.create(
        owner=user,
        title="My board",
        layout={
            **empty_layout(),
            "nodes": [
                {
                    "id": "sample-note",
                    "type": "item",
                    "item": str(sample_note.id),
                    "x": 0,
                    "y": 0,
                    "w": 280,
                    "h": None,
                    "parent": None,
                },
                {
                    "id": "real-note",
                    "type": "item",
                    "item": str(real_board_note.id),
                    "x": 0,
                    "y": 300,
                    "w": 280,
                    "h": None,
                    "parent": None,
                },
            ],
        },
    )
    normal_board.items.add(sample_note, real_board_note)

    collection_note = Item.objects.create(
        owner=user,
        kind="note",
        body="Keep from collection",
        status=Item.Status.ORGANIZED,
    )
    Collection.objects.get(owner=user, name="Projects").items.add(collection_note)

    assert client.delete("/api/auth/sample-content/").status_code == 204

    on_sample_board.refresh_from_db()
    collection_note.refresh_from_db()
    normal_board.refresh_from_db()
    assert on_sample_board.status == Item.Status.INBOX
    assert collection_note.status == Item.Status.INBOX
    assert list(normal_board.items.all()) == [real_board_note]
    assert [node["item"] for node in normal_board.layout["nodes"]] == [
        str(real_board_note.id)
    ]
    assert Item.objects.filter(id=real_board_note.id, body="Keep on board").exists()


def test_sample_content_endpoints_require_a_session():
    client = Client()
    assert client.post("/api/auth/sample-content/").status_code == 403
    assert client.delete("/api/auth/sample-content/").status_code == 403
