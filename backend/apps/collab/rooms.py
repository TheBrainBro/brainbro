"""
The notes open in this process, each a room: its shared document, kept in
memory while someone has the note open, and the sessions editing it.

A session's edits go to the others in the room as they come, and through
Redis to the same note's rooms in the other `api` processes (see `relay`).
The merged document is saved (`documents.save_document`) a few seconds after
it changes and when the last session leaves.
"""

import asyncio
import logging
import time
import uuid

import redis.asyncio as aioredis
from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import close_old_connections
from pycrdt import (
    Doc,
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
)
from redis.exceptions import RedisError

from apps.items.models import Item

from . import documents, relay
from .documents import EMPTY_UPDATE
from .protocol import (
    MESSAGE_QUERY_AWARENESS,
    awareness_message,
    decode_awareness,
    encode_awareness,
)

logger = logging.getLogger(__name__)

SAVE_DELAY_SECONDS = 3
# Presence not renewed for this long is gone, as Yjs clients see it.
AWARENESS_TIMEOUT_SECONDS = 30
# The WebSocket close code for a note that no longer exists.
CLOSE_GONE = 4404


def in_thread(function):
    """Runs database code off the event loop, dropping stale connections around it."""

    @sync_to_async
    def run(*args):
        close_old_connections()
        try:
            return function(*args)
        finally:
            close_old_connections()

    return run


class Session:
    """
    One open connection to a note. What goes out to it waits in a queue for
    `write`, so a slow connection never holds up the rest of the room.
    """

    def __init__(self, send):
        self._send = send
        self.queue = asyncio.Queue()
        # The awareness clients it announced: they leave with it.
        self.clients = set()

    def send(self, message):
        self.queue.put_nowait({"type": "websocket.send", "bytes": message})

    def close(self, code=1000):
        self.queue.put_nowait({"type": "websocket.close", "code": code})

    async def write(self):
        while True:
            event = await self.queue.get()
            try:
                await self._send(event)
            except Exception:
                # Gone already: nothing more reaches it.
                return
            if event["type"] == "websocket.close":
                return


class Room:
    def __init__(self, rooms, note_id):
        self.rooms = rooms
        self.note_id = note_id
        self.doc = Doc()
        self.sessions = set()
        # Everyone's presence in the note, here and in other processes:
        # {client: (clock, state as JSON text, when it was last heard of)}.
        self.awareness = {}
        self.unsaved = False
        self.saving = None
        self.redis = None
        self.pubsub = None
        self.listener = None

    async def open(self):
        # Subscribed before loading, so nothing sent meanwhile is missed.
        try:
            self.redis = aioredis.Redis.from_url(settings.REDIS_URL)
            self.pubsub = self.redis.pubsub()
            await self.pubsub.subscribe(relay.channel(self.note_id))
        except RedisError:
            logger.warning("Note open without Redis: only this process sees edits.")
            await self.disconnect()
        try:
            self.doc.apply_update(
                await in_thread(documents.open_document)(self.note_id)
            )
        except BaseException:
            await self.disconnect()
            raise
        if self.pubsub is not None:
            self.listener = asyncio.create_task(self.listen())
            # Edits other processes hold and haven't saved yet.
            await self.publish(relay.QUERY, self.doc.get_state())

    def join(self, session):
        self.sessions.add(session)
        # It answers with what it has that the room lacks (offline edits).
        session.send(create_sync_message(self.doc))
        if present := self.present():
            session.send(awareness_message(present))

    async def receive(self, session, message):
        if message[0] == YMessageType.SYNC:
            if message[1] == YSyncMessageType.SYNC_STEP1:
                session.send(handle_sync_message(message[1:], self.doc))
            elif message[1] in (
                YSyncMessageType.SYNC_STEP2,
                YSyncMessageType.SYNC_UPDATE,
            ):
                update = read_message(message[2:])
                if update != EMPTY_UPDATE:
                    self.doc.apply_update(update)
                    self.broadcast(create_update_message(update), but=session)
                    await self.publish(relay.UPDATE, update)
                    self.changed()
        elif message[0] == YMessageType.AWARENESS:
            update = read_message(message[1:])
            entries = decode_awareness(update)
            session.clients.update(entries)
            self.remember(entries)
            self.broadcast(message, but=session)
            await self.publish(relay.AWARENESS, update)
        elif message[0] == MESSAGE_QUERY_AWARENESS:
            session.send(awareness_message(self.present()))

    async def leave(self, session):
        self.sessions.discard(session)
        gone = {
            client: (self.awareness.pop(client)[0] + 1, "null")
            for client in session.clients
            if client in self.awareness
        }
        if gone:
            self.broadcast(awareness_message(gone))
            await self.publish(relay.AWARENESS, encode_awareness(gone))

    def broadcast(self, message, but=None):
        for session in self.sessions:
            if session is not but:
                session.send(message)

    def remember(self, entries):
        now = time.monotonic()
        for client, (clock, state) in entries.items():
            if state == "null":
                self.awareness.pop(client, None)
            else:
                self.awareness[client] = (clock, state, now)

    def present(self, only=None):
        """Presence still current, as awareness entries; of `only` these clients."""
        oldest = time.monotonic() - AWARENESS_TIMEOUT_SECONDS
        return {
            client: (clock, state)
            for client, (clock, state, seen) in self.awareness.items()
            if seen > oldest and (only is None or client in only)
        }

    def changed(self):
        self.unsaved = True
        if self.saving is None:
            self.saving = asyncio.create_task(self.save_soon())

    async def save_soon(self):
        await asyncio.sleep(SAVE_DELAY_SECONDS)
        self.saving = None
        await self.save()

    async def save(self):
        if not self.unsaved:
            return
        # Edits that come in while this saves go in the next save.
        self.unsaved = False
        try:
            missing = await in_thread(documents.save_document)(
                self.note_id, self.doc.get_update()
            )
        except Item.DoesNotExist:
            for session in self.sessions:
                session.close(CLOSE_GONE)
            return
        except Exception:
            logger.exception("Couldn't save note %s; trying again.", self.note_id)
            self.changed()
            return
        if missing:
            self.doc.apply_update(missing)
            self.broadcast(create_update_message(missing))
            await self.publish(relay.UPDATE, missing)

    async def close(self):
        """The last session left: save what's left and stop listening."""
        if self.saving is not None:
            self.saving.cancel()
            self.saving = None
        await self.save()
        await self.disconnect()

    async def publish(self, kind, payload):
        if self.redis is None:
            return
        message = relay.frame(self.rooms.source, kind, payload)
        try:
            await self.redis.publish(relay.channel(self.note_id), message)
        except RedisError:
            logger.warning("Couldn't send a note's edit to other processes.")

    async def listen(self):
        while True:
            try:
                async for message in self.pubsub.listen():
                    if message["type"] == "message":
                        await self.relayed(message["data"])
            except RedisError:
                logger.warning("Lost Redis for note %s; reconnecting.", self.note_id)
                await asyncio.sleep(1)

    async def relayed(self, data):
        source, kind, payload = relay.parse(data)
        if source == self.rooms.source:
            return
        if kind == relay.UPDATE:
            self.doc.apply_update(payload)
            self.broadcast(create_update_message(payload))
        elif kind == relay.AWARENESS:
            self.remember(decode_awareness(payload))
            self.broadcast(create_awareness_message(payload))
        elif kind == relay.QUERY:
            missing = self.doc.get_update(payload)
            if missing != EMPTY_UPDATE:
                await self.publish(relay.UPDATE, missing)
            clients = set().union(*(session.clients for session in self.sessions))
            if present := self.present(only=clients):
                await self.publish(relay.AWARENESS, encode_awareness(present))

    async def disconnect(self):
        if self.listener is not None:
            self.listener.cancel()
            self.listener = None
        try:
            if self.pubsub is not None:
                await self.pubsub.aclose()
            if self.redis is not None:
                await self.redis.aclose()
        except RedisError:
            pass
        self.pubsub = None
        self.redis = None


class Rooms:
    """This process's rooms, by note id. `source` tells its messages apart in Redis."""

    def __init__(self, source=None):
        self.source = source or uuid.uuid4().bytes
        self.open = {}
        self.opening = {}
        self.closing = {}

    async def join(self, note_id, session):
        # Reopened while it was closing: after its last save, so none is lost.
        while closing := self.closing.get(note_id):
            await asyncio.shield(closing)
        room = self.open.get(note_id)
        if room is None:
            room = self.open[note_id] = Room(self, note_id)
            self.opening[note_id] = asyncio.ensure_future(room.open())
        opening = self.opening.get(note_id)
        if opening is not None:
            try:
                await asyncio.shield(opening)
            except BaseException:
                if self.open.get(note_id) is room:
                    del self.open[note_id]
                raise
            finally:
                if self.opening.get(note_id) is opening and opening.done():
                    del self.opening[note_id]
        room.join(session)
        return room

    async def leave(self, room, session):
        await room.leave(session)
        # Someone may have joined while it was telling the others.
        if room.sessions or self.open.get(room.note_id) is not room:
            return
        del self.open[room.note_id]
        closing = self.closing[room.note_id] = asyncio.ensure_future(room.close())
        try:
            await asyncio.shield(closing)
        finally:
            if self.closing.get(room.note_id) is closing:
                del self.closing[room.note_id]
