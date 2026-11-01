"""
A note's shared document in the database (`NoteDocument`), with its text
kept in `Item.body` for everything else: search, MCP, exports, the graph.

Only the server builds a document from Markdown, and only once per note: two
documents built apart from the same text would merge into it twice. The
note's row stays locked while its document is built or saved.

Whatever writes `body` without going through the document (the REST API from
an older app, an assistant) calls `body_written`, which merges it in as an
edit; anything else is noticed the next time the document is opened or saved.
"""

import time
import zlib

from django.db import transaction
from pycrdt import Doc

from apps.events.changes import made_by
from apps.items.models import Item
from apps.items.notes import sync_images

from . import relay
from .models import NoteDocument
from .protocol import encode_awareness, state_json
from .text import rewrite, text_of

# What an update with nothing in it encodes to.
EMPTY_UPDATE = b"\x00\x00"

# Cursor colors for assistants, picked by name.
ASSISTANT_COLORS = ["#7c3aed", "#0891b2", "#c2410c", "#be185d", "#4d7c0f"]


def locked_note(note_id):
    return Item.objects.select_for_update().get(id=note_id, kind=Item.Kind.NOTE)


def state_vector(update):
    doc = Doc()
    doc.apply_update(update)
    return doc.get_state()


def build(item, document):
    """
    The note's document as stored, with what was written to its body outside
    it merged in; and whether that changed it.
    """
    doc = Doc()
    if document is not None:
        doc.apply_update(bytes(document.state))
    if str(text_of(doc)) == item.body:
        return doc, False
    rewrite(doc, item.body)
    return doc, True


def store(item, document, doc):
    state = doc.get_update()
    if document is None:
        NoteDocument.objects.create(note=item, state=state)
    else:
        document.state = state
        document.save(update_fields=["state", "updated_at"])


@transaction.atomic
def open_document(note_id):
    """The note's document, encoded, for a room to start from."""
    item = locked_note(note_id)
    document = NoteDocument.objects.filter(note=item).first()
    doc, changed = build(item, document)
    if document is not None and changed:
        # Other processes may have it open: they get the edit too.
        before = state_vector(bytes(document.state))
        send(note_id, relay.UPDATE, doc.get_update(before))
    if document is None or changed:
        store(item, document, doc)
    return doc.get_update()


@transaction.atomic
def save_document(note_id, state):
    """
    Merges a room's document into the stored one and writes its text to the
    note's body. Returns what the room lacks (edits made outside it), or
    None. Raises Item.DoesNotExist once the note is gone.
    """
    item = locked_note(note_id)
    document = NoteDocument.objects.filter(note=item).first()
    doc, _ = build(item, document)
    doc.apply_update(state)
    store(item, document, doc)
    body = str(text_of(doc))
    if body != item.body:
        item.body = body
        item.save(update_fields=["body", "updated_at"])
        sync_images(item)
    missing = doc.get_update(state_vector(state))
    return None if missing == EMPTY_UPDATE else missing


@transaction.atomic
def body_written(note):
    """
    The note's body was just saved outside its document: merge it in, and
    show it to the sessions that have the note open, with the assistant's
    cursor on what it wrote when one did.
    """
    item = locked_note(note.id)
    document = NoteDocument.objects.filter(note=item).first()
    if document is None:
        # Never opened live: it is built from the body when it is.
        return
    doc = Doc()
    doc.apply_update(bytes(document.state))
    before = doc.get_state()
    if str(text_of(doc)) == item.body:
        return
    selection = rewrite(doc, item.body)
    store(item, document, doc)
    send(item.id, relay.UPDATE, doc.get_update(before))
    if (name := made_by()) and selection:
        send(item.id, relay.AWARENESS, assistant_presence(name, selection))


def assistant_presence(name, selection):
    """An awareness update showing the assistant `name` on `selection`."""
    client = zlib.crc32(f"assistant:{name}".encode())
    color = ASSISTANT_COLORS[client % len(ASSISTANT_COLORS)]
    state = {
        "user": {"name": name, "color": color, "colorLight": f"{color}33"},
        "assistant": True,
        "cursor": selection,
    }
    # Milliseconds: the clock only has to go up between two edits.
    return encode_awareness({client: (int(time.time() * 1000), state_json(state))})


def send(note_id, kind, payload):
    """Once the transaction commits: a room must never apply what was rolled back."""
    transaction.on_commit(lambda: relay.publish(note_id, kind, payload))
