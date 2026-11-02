import json

import pytest
import redis
from django.test import Client

from apps.accounts.models import ApiToken
from apps.boards.layout import empty_layout
from apps.boards.models import Board
from apps.events import changes
from apps.events.changes import changed, collect
from apps.events.changes import publish as real_publish
from apps.events.receivers import send_collected, start_collecting
from apps.items.models import Collection, Item
from apps.items.tasks import generate_thumbnail

pytestmark = pytest.mark.django_db


@pytest.fixture
def note(user):
    return Item.objects.create(owner=user, kind="note", body="Hello")


@pytest.fixture
def commit(django_capture_on_commit_callbacks):
    """Runs what waits for the transaction to commit, as a real commit would."""
    return lambda: django_capture_on_commit_callbacks(execute=True)


def test_a_change_waits_for_the_commit(django_capture_on_commit_callbacks, published):
    with django_capture_on_commit_callbacks() as callbacks:
        changed("u1", items=["a"])
    assert published == []
    callbacks[0]()
    assert published == [("u1", {"items": ["a"], "boards": {}, "tab": "", "by": ""})]


def test_collect_sends_one_message_per_owner(commit, published):
    with commit():
        with collect(tab="t1", by="Claude"):
            changed("u1", items=["b"])
            changed("u1", items=["a", "b"], boards={"x": 3})
            changed("u1", boards={"x": 2})
            changed("u2")
    assert sorted(published) == [
        ("u1", {"items": ["a", "b"], "boards": {"x": 3}, "tab": "t1", "by": "Claude"}),
        ("u2", {"items": [], "boards": {}, "tab": "t1", "by": "Claude"}),
    ]


def test_a_nested_collect_sends_its_own(commit, published):
    with commit():
        with collect(tab="t1"):
            changed("u1", items=["a"])
            with collect(by="Claude"):
                changed("u1", items=["b"])
    assert [(message["items"], message["by"]) for _, message in published] == [
        (["b"], "Claude"),
        (["a"], ""),
    ]


def test_the_tab_id_is_cut_short(commit, published):
    with commit():
        with collect(tab="t" * 500):
            changed("u1")
    assert len(published[0][1]["tab"]) == changes.TAB_MAX_LENGTH


def test_a_redis_failure_doesnt_break_the_change(monkeypatch, caplog):
    class Down:
        def publish(self, *args):
            raise redis.ConnectionError("down")

    monkeypatch.setattr(changes, "connection", lambda: Down())
    real_publish("u1", {"items": []})
    assert "Couldn't tell open tabs" in caplog.text


def test_a_request_tells_with_its_tab(api, user, note, commit, published):
    with commit():
        response = api.patch(
            f"/api/items/{note.id}/",
            {"body": "Hello again"},
            format="json",
            headers={"If-Match": f'"{note.version}"', "X-BrainBro-Tab": "tab-1"},
        )
    assert response.status_code == 200
    assert published == [
        (
            str(user.id),
            {"items": [str(note.id)], "boards": {}, "tab": "tab-1", "by": ""},
        )
    ]


def test_bulk_triage_tells_which_items(api, user, commit, published):
    notes = [
        Item.objects.create(owner=user, kind="note", body=str(i)) for i in range(2)
    ]
    work = Collection.objects.create(owner=user, name="Work")
    published.clear()
    with commit():
        api.post(
            "/api/items/triage/",
            {
                "ids": [str(item.id) for item in notes],
                "action": "organize",
                "collections": [str(work.id)],
            },
            format="json",
        )
    [(owner_id, message)] = published
    assert owner_id == str(user.id)
    assert message["items"] == sorted(str(item.id) for item in notes)


def test_reordering_the_inbox_tells(api, user, note, commit, published):
    other = Item.objects.create(owner=user, kind="note", body="Other")
    published.clear()
    with commit():
        api.post(f"/api/items/{note.id}/move/", {"after": str(other.id)}, format="json")
    assert [owner_id for owner_id, _ in published] == [str(user.id)]


def test_a_collection_change_tells(api, user, commit, published):
    with commit():
        api.post("/api/collections/", {"name": "Reading"}, format="json")
    assert published == [
        (str(user.id), {"items": [], "boards": {}, "tab": "", "by": ""})
    ]


def test_a_board_save_tells_its_revision(api, user, commit, published):
    board = Board.objects.create(owner=user, title="Ideas")
    published.clear()
    with commit():
        api.put(
            f"/api/boards/{board.id}/layout/",
            empty_layout(),
            format="json",
            HTTP_IF_MATCH=f'"{board.revision}"',
        )
    [(_, message)] = published
    assert message["boards"] == {str(board.id): 2}


def test_an_assistant_is_named(user, note, commit, published):
    key = ApiToken.issue(user, "Claude")[1]
    with commit():
        response = Client().post(
            "/api/mcp/",
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "edit_note",
                        "arguments": {"id": str(note.id), "append": "More"},
                    },
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {key}",
        )
    assert response.status_code == 200
    assert published == [
        (
            str(user.id),
            {"items": [str(note.id)], "boards": {}, "tab": "", "by": "Claude"},
        )
    ]


def test_a_task_tells_once_when_it_ends(user, commit, published):
    with commit():
        start_collecting(task_id="task-1")
        Item.objects.create(owner=user, kind="note", body="One")
        Item.objects.create(owner=user, kind="note", body="Two")
        assert published == []
        send_collected(task_id="task-1")
    [(_, message)] = published
    assert len(message["items"]) == 2


def test_a_preview_task_tells(user, commit, published, monkeypatch):
    item = Item.objects.create(owner=user, kind="link", url="https://example.com")
    published.clear()
    monkeypatch.setattr("apps.items.tasks.has_thumbnail", lambda item: True)
    monkeypatch.setattr("apps.items.tasks.make_thumbnail", lambda item: None)
    Item.objects.filter(id=item.id).update(file="uploads/x.png")
    # Called directly, not through Celery: what it changes goes out on its own.
    with commit():
        generate_thumbnail(str(item.id))
    assert published == [
        (str(user.id), {"items": [str(item.id)], "boards": {}, "tab": "", "by": ""})
    ]
