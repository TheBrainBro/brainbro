"""
A note's live messages between processes, over Redis pub/sub, one channel
per note: each `api` process holds its own copy of an open note (see
`rooms`), and they keep each other up to date. Edits made outside any room
(the REST API, assistants) go out here too.

A message is the 16-byte id of the process that sent it, a kind, and its
payload: a document update, an awareness update, or a state vector asking
the others for what it lacks.
"""

import logging

import redis

from apps.events.changes import connection

logger = logging.getLogger(__name__)

UPDATE = b"U"
AWARENESS = b"A"
QUERY = b"Q"

SOURCE_LENGTH = 16
# Where edits made outside any room come from: no process in particular.
OUTSIDE = bytes(SOURCE_LENGTH)


def channel(note_id):
    return f"brainbro:note:{note_id}"


def frame(source, kind, payload):
    return source + kind + payload


def parse(data):
    """(source, kind, payload) of a message."""
    return data[:SOURCE_LENGTH], data[SOURCE_LENGTH : SOURCE_LENGTH + 1], data[17:]


def publish(note_id, kind, payload):
    """Sends a message to the rooms that have the note open, from outside them."""
    try:
        connection().publish(channel(note_id), frame(OUTSIDE, kind, payload))
    except redis.RedisError:
        # Saved anyway: open sessions get it when they next reconnect.
        logger.warning("Couldn't send a note's edit to open sessions.", exc_info=True)
