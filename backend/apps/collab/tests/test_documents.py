import pytest
from pycrdt import Doc

from apps.collab import relay
from apps.collab.documents import (
    body_written,
    open_document,
    save_document,
)
from apps.collab.models import NoteDocument
from apps.collab.protocol import decode_awareness
from apps.collab.text import rewrite, text_of
from apps.events.changes import collect
from apps.items.models import Item


@pytest.fixture
def note(user):
    return Item.objects.create(owner=user, kind="note", body="# Plan\n\nFirst step\n")


@pytest.fixture
def commit(django_capture_on_commit_callbacks):
    return lambda: django_capture_on_commit_callbacks(execute=True)


def doc_of(update):
    doc = Doc()
    doc.apply_update(update)
    return doc


def text(doc):
    return str(text_of(doc))


def test_opening_builds_the_document_from_the_body_once(note):
    first = open_document(note.id)
    second = open_document(note.id)
    assert NoteDocument.objects.filter(note=note).count() == 1
    # Built once: two processes opening it share it, and nothing doubles.
    doc = doc_of(first)
    doc.apply_update(second)
    assert text(doc) == note.body


def test_opening_merges_what_was_written_outside_it(note, commit, relayed):
    stored = open_document(note.id)
    Item.objects.filter(id=note.id).update(body="# Plan\n\nFirst step\nSecond\n")
    with commit():
        reopened = open_document(note.id)
    assert text(doc_of(reopened)) == "# Plan\n\nFirst step\nSecond\n"
    # Rooms elsewhere get it as an edit on what they hold.
    [(note_id, kind, update)] = relayed
    assert (note_id, kind) == (str(note.id), relay.UPDATE)
    doc = doc_of(stored)
    doc.apply_update(update)
    assert text(doc) == "# Plan\n\nFirst step\nSecond\n"


def test_saving_merges_the_rooms_and_writes_the_body(note):
    base = open_document(note.id)
    laptop, phone = doc_of(base), doc_of(base)
    rewrite(laptop, "# Plan\n\nFirst step, done\n")
    rewrite(phone, "# Plan\n\nFirst step\nFrom the phone\n")
    assert save_document(note.id, laptop.get_update()) is None
    missing = save_document(note.id, phone.get_update())
    note.refresh_from_db()
    assert note.body == "# Plan\n\nFirst step, done\nFrom the phone\n"
    # The phone's room gets the laptop's edit back.
    phone.apply_update(missing)
    assert text(phone) == note.body


def test_saving_keeps_what_was_written_outside_the_document(note):
    room = doc_of(open_document(note.id))
    Item.objects.filter(id=note.id).update(body="# Plan\n\nFirst step\nImported\n")
    rewrite(room, "# Plan, live\n\nFirst step\n")
    missing = save_document(note.id, room.get_update())
    note.refresh_from_db()
    assert note.body == "# Plan, live\n\nFirst step\nImported\n"
    room.apply_update(missing)
    assert text(room) == note.body


def test_saving_finds_the_notes_images(note, monkeypatch):
    calls = []
    monkeypatch.setattr("apps.collab.documents.sync_images", calls.append)
    room = doc_of(open_document(note.id))
    rewrite(room, note.body + "![](https://example.com/a.png)\n")
    save_document(note.id, room.get_update())
    assert [item.id for item in calls] == [note.id]


def test_saving_a_deleted_note_fails(note):
    state = open_document(note.id)
    note.delete()
    with pytest.raises(Item.DoesNotExist):
        save_document(note.id, state)


def test_a_body_written_on_a_note_never_opened_live_is_left_as_is(note, relayed):
    body_written(note)
    assert not NoteDocument.objects.exists()
    assert relayed == []


def test_a_body_written_outside_reaches_open_sessions(note, commit, relayed):
    room = doc_of(open_document(note.id))
    note.body = "# Plan\n\nFirst step\nSecond step\n"
    note.save()
    with commit():
        body_written(note)
    [(_, kind, update)] = relayed
    assert kind == relay.UPDATE
    room.apply_update(update)
    assert text(room) == note.body
    document = NoteDocument.objects.get(note=note)
    assert text(doc_of(bytes(document.state))) == note.body


def test_an_assistants_edit_shows_its_cursor(note, commit, relayed):
    open_document(note.id)
    note.body += "Added by Claude\n"
    note.save()
    with commit(), collect(by="Claude"):
        body_written(note)
    [update, (_, kind, payload)] = relayed
    assert update[1] == relay.UPDATE
    assert kind == relay.AWARENESS
    [(_, state)] = decode_awareness(payload).values()
    assert '"name":"Claude"' in state
    assert '"cursor":{"anchor"' in state


def test_a_save_from_a_client_without_the_socket_reaches_open_sessions(
    api, note, commit, relayed
):
    open_document(note.id)
    with commit():
        response = api.patch(
            f"/api/items/{note.id}/", {"body": "Saved the old way"}, format="json"
        )
    assert response.status_code == 200
    [(_, kind, _)] = relayed
    assert kind == relay.UPDATE
    document = NoteDocument.objects.get(note=note)
    assert text(doc_of(bytes(document.state))) == "Saved the old way"
