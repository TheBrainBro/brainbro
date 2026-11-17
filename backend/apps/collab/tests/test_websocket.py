import asyncio

import pytest
from asgiref.sync import async_to_sync, sync_to_async
from django.conf import settings
from django.contrib.sessions.backends.db import SessionStore
from django.test import Client
from pycrdt import (
    Doc,
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
)

from apps.collab import asgi, relay, rooms
from apps.collab.protocol import awareness_message, decode_awareness, state_json
from apps.collab.text import rewrite, text_of
from apps.events.changes import collect
from apps.items.models import Item
from apps.mcp.tools import edit_note

pytestmark = pytest.mark.django_db(transaction=True)

TIMEOUT = 5


class Broker:
    """Redis pub/sub in memory, shared by the fake processes of a test."""

    def __init__(self):
        self.queues = {}

    def deliver(self, channel, data):
        for queue in self.queues.get(channel, []):
            queue.put_nowait({"type": "message", "data": data})


class FakePubSub:
    def __init__(self, broker):
        self.broker = broker
        self.queue = asyncio.Queue()
        self.channels = []

    async def subscribe(self, channel):
        self.channels.append(channel)
        self.broker.queues.setdefault(channel, []).append(self.queue)

    async def listen(self):
        while True:
            yield await self.queue.get()

    async def aclose(self):
        for channel in self.channels:
            self.broker.queues[channel].remove(self.queue)


class FakeRedis:
    def __init__(self, broker):
        self.broker = broker

    def pubsub(self):
        return FakePubSub(self.broker)

    async def publish(self, channel, data):
        self.broker.deliver(channel, data)

    async def aclose(self):
        pass


@pytest.fixture
def broker(monkeypatch):
    broker = Broker()
    monkeypatch.setattr(rooms.aioredis.Redis, "from_url", lambda url: FakeRedis(broker))
    monkeypatch.setattr(asgi, "rooms", rooms.Rooms())
    return broker


@pytest.fixture
def note(user):
    return Item.objects.create(owner=user, kind="note", body="Hello")


def cookie_of(user):
    client = Client()
    client.force_login(user)
    return client.cookies[settings.SESSION_COOKIE_NAME].value


class Connection:
    """A browser tab's socket to a note, with its own copy of the document."""

    def __init__(self, note_id, cookie="", origin="http://localhost"):
        headers = [(b"host", b"localhost"), (b"origin", origin.encode())]
        if cookie:
            headers.append((b"cookie", f"sessionid={cookie}".encode()))
        self.scope = {
            "type": "websocket",
            "path": f"/api/live/notes/{note_id}",
            "headers": headers,
        }
        self.inbox = asyncio.Queue()
        self.outbox = asyncio.Queue()
        self.doc = Doc()
        self.awareness = {}

    async def open(self, app=None):
        """Connects; what the server answers (accept, or close)."""
        app = app or asgi.websocket
        self.task = asyncio.create_task(
            app(self.scope, self.inbox.get, self.outbox.put)
        )
        await self.inbox.put({"type": "websocket.connect"})
        return await self.next_event()

    async def next_event(self):
        return await asyncio.wait_for(self.outbox.get(), TIMEOUT)

    async def send(self, message):
        await self.inbox.put({"type": "websocket.receive", "bytes": message})

    async def sync(self):
        """Exchanges what each side lacks, as y-websocket does on connect."""
        await self.send(create_sync_message(self.doc))
        while True:
            message = (await self.next_event())["bytes"]
            await self.handle(message)
            if message[:2] == bytes([YMessageType.SYNC, YSyncMessageType.SYNC_STEP2]):
                return

    async def handle(self, message):
        if message[0] == YMessageType.SYNC:
            reply = handle_sync_message(message[1:], self.doc)
            if reply is not None:
                await self.send(reply)
        elif message[0] == YMessageType.AWARENESS:
            self.awareness.update(decode_awareness(read_message(message[1:])))

    async def until(self, condition):
        while not condition():
            await self.handle((await self.next_event())["bytes"])

    async def edit(self, new):
        before = self.doc.get_state()
        rewrite(self.doc, new)
        await self.send(create_update_message(self.doc.get_update(before)))

    def text(self):
        return str(text_of(self.doc))

    async def close(self):
        await self.inbox.put({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(self.task, TIMEOUT)


def run(scenario):
    async_to_sync(scenario)()


async def refused(connection):
    assert (await connection.open())["type"] == "websocket.accept"
    # A code that tells y-websocket not to retry.
    return await connection.next_event() == {
        "type": "websocket.close",
        "code": asgi.CLOSE_FORBIDDEN,
    }


def test_refuses_without_a_session(broker, note):
    async def scenario():
        assert await refused(Connection(note.id))

    run(scenario)


def test_refuses_another_site(broker, note, user):
    cookie = cookie_of(user)

    async def scenario():
        connection = Connection(note.id, cookie, origin="https://evil.example")
        assert await refused(connection)

    run(scenario)


def test_refuses_someone_elses_note(broker, note, other_user):
    cookie = cookie_of(other_user)

    async def scenario():
        assert await refused(Connection(note.id, cookie))

    run(scenario)


async def closed_with(connection):
    """The code the server closes `connection` with, skipping what comes before."""
    while True:
        event = await connection.next_event()
        if event["type"] == "websocket.close":
            return event["code"]


@pytest.fixture
def recheck_often(monkeypatch):
    monkeypatch.setattr(asgi, "RECHECK_SECONDS", 0.05)


@pytest.mark.parametrize("ending", ["sign_out", "disable"])
def test_an_open_connection_ends_with_its_sign_in(
    broker, note, user, recheck_often, ending
):
    cookie = cookie_of(user)

    async def scenario():
        laptop = Connection(note.id, cookie)
        await laptop.open()
        await laptop.sync()

        if ending == "sign_out":
            await sync_to_async(SessionStore(cookie).delete)()
        else:
            user.is_active = False
            await sync_to_async(user.save)()

        assert await closed_with(laptop) == asgi.CLOSE_FORBIDDEN
        # Nothing it sends after that is applied.
        await laptop.edit("Hello, too late")
        await laptop.close()

    run(scenario)
    note.refresh_from_db()
    assert note.body == "Hello"


def test_a_connection_still_signed_in_stays_open(broker, note, user, recheck_often):
    cookie = cookie_of(user)

    async def scenario():
        laptop, phone = Connection(note.id, cookie), Connection(note.id, cookie)
        await laptop.open()
        await laptop.sync()
        await phone.open()
        await phone.sync()
        # Several checks go by.
        await asyncio.sleep(0.3)

        await laptop.edit("Hello again")
        await phone.until(lambda: phone.text() == "Hello again")
        await laptop.close()
        await phone.close()

    run(scenario)


def test_two_sessions_edit_together_and_the_body_is_saved(broker, note, user):
    cookie = cookie_of(user)

    async def scenario():
        laptop, phone = Connection(note.id, cookie), Connection(note.id, cookie)
        assert (await laptop.open())["type"] == "websocket.accept"
        await laptop.sync()
        assert laptop.text() == "Hello"
        await phone.open()
        await phone.sync()

        await laptop.edit("Hello world")
        await phone.until(lambda: phone.text() == "Hello world")
        await phone.edit("Hello world, from the phone")
        await laptop.until(lambda: laptop.text() == "Hello world, from the phone")

        await laptop.close()
        await phone.close()

    run(scenario)
    note.refresh_from_db()
    assert note.body == "Hello world, from the phone"


def test_offline_edits_merge_on_reconnect(broker, note, user):
    cookie = cookie_of(user)

    async def scenario():
        phone = Connection(note.id, cookie)
        await phone.open()
        await phone.sync()
        await phone.close()

        # Edited offline, while the laptop edits too.
        rewrite(phone.doc, "Hello from the train")
        laptop = Connection(note.id, cookie)
        await laptop.open()
        await laptop.sync()
        await laptop.edit("Well, Hello")
        await laptop.close()

        reconnected = Connection(note.id, cookie)
        reconnected.doc = phone.doc
        await reconnected.open()
        await reconnected.sync()
        assert reconnected.text() == "Well, Hello from the train"
        await reconnected.close()

    run(scenario)
    note.refresh_from_db()
    assert note.body == "Well, Hello from the train"


def test_edits_reach_sessions_in_another_process(broker, note, user):
    cookie = cookie_of(user)
    elsewhere = rooms.Rooms()

    async def other_process(scope, receive, send):
        # The same handler, with the rooms of another process.
        original = asgi.rooms
        asgi.rooms = elsewhere
        try:
            await asgi.websocket(scope, receive, send)
        finally:
            asgi.rooms = original

    async def scenario():
        here = Connection(note.id, cookie)
        await here.open()
        await here.sync()
        there = Connection(note.id, cookie)
        await there.open(app=other_process)
        await there.sync()

        await here.edit("Hello there")
        await there.until(lambda: there.text() == "Hello there")
        await there.edit("Hello there, again")
        await here.until(lambda: here.text() == "Hello there, again")
        await here.close()
        await there.close()

    run(scenario)
    note.refresh_from_db()
    assert note.body == "Hello there, again"


def test_sessions_see_each_other_and_who_left(broker, note, user):
    cookie = cookie_of(user)
    laptop_state = state_json({"user": {"name": "Chrome on Mac", "color": "#000"}})

    async def scenario():
        laptop, phone = Connection(note.id, cookie), Connection(note.id, cookie)
        await laptop.open()
        await laptop.sync()
        await phone.open()
        await phone.sync()

        await laptop.send(awareness_message({42: (1, laptop_state)}))
        await phone.until(lambda: phone.awareness.get(42) == (1, laptop_state))
        await laptop.close()
        await phone.until(lambda: phone.awareness[42] == (2, "null"))
        await phone.close()

    run(scenario)


def test_an_assistant_edit_merges_into_an_open_note(broker, note, user, relayed):
    cookie = cookie_of(user)

    @sync_to_async
    def assistant_appends():
        with collect(by="Claude"):
            edit_note(user, {"id": note.id, "append": "From Claude"})

    async def scenario():
        tab = Connection(note.id, cookie)
        await tab.open()
        await tab.sync()
        await assistant_appends()
        # What `relay.publish` would have sent through Redis.
        for note_id, kind, payload in relayed:
            broker.deliver(
                relay.channel(note_id), relay.frame(relay.OUTSIDE, kind, payload)
            )
        await tab.until(lambda: tab.text() == "Hello\nFrom Claude")
        await tab.until(lambda: any('"Claude"' in s for _, s in tab.awareness.values()))
        await tab.close()

    run(scenario)
    note.refresh_from_db()
    assert note.body == "Hello\nFrom Claude"


@pytest.mark.parametrize(
    ("host", "allowed"),
    [
        ("localhost", True),
        ("192.168.1.50:8420", True),
        ("[::1]:8000", True),
        ("blog.example.com", False),
        ("", False),
    ],
)
def test_the_socket_opens_on_the_app_s_hosts_and_ip_addresses(host, allowed):
    scope = {"type": "websocket", "headers": [(b"host", host.encode())]}

    assert asgi.allowed_host(scope) is allowed
