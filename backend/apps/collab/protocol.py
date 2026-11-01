"""
The pieces of the Yjs wire protocol (y-protocols, as y-websocket speaks it)
that pycrdt leaves to us: awareness updates, which carry who is in a note and
where their cursor is.

An awareness update is a count, then for each client its id, a clock that
goes up with every change, and its state as JSON ("null" once it leaves).
"""

import json

from pycrdt import Decoder, YMessageType, create_awareness_message, write_var_uint

# y-websocket's message types beyond sync and awareness.
MESSAGE_AUTH = 2
MESSAGE_QUERY_AWARENESS = 3


def write_var_string(value):
    data = value.encode()
    return write_var_uint(len(data)) + data


def decode_awareness(update):
    """{client id: (clock, state as JSON text)} from an awareness update."""
    decoder = Decoder(update)
    entries = {}
    for _ in range(decoder.read_var_uint()):
        client = decoder.read_var_uint()
        clock = decoder.read_var_uint()
        entries[client] = (clock, decoder.read_message().decode())
    return entries


def encode_awareness(entries):
    """An awareness update from {client id: (clock, state as JSON text)}."""
    parts = [write_var_uint(len(entries))]
    for client, (clock, state) in entries.items():
        parts += [
            write_var_uint(client),
            write_var_uint(clock),
            write_var_string(state),
        ]
    return b"".join(parts)


def awareness_message(entries):
    return create_awareness_message(encode_awareness(entries))


def state_json(state):
    return json.dumps(state, separators=(",", ":"))


def is_awareness(message):
    return message[0] == YMessageType.AWARENESS
