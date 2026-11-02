import json

import pytest
from asgiref.sync import async_to_sync
from django.test import AsyncClient

from apps.events import views


class FakePubSub:
    """One message, then nothing: as if the channel went quiet."""

    def __init__(self, messages):
        self.messages = messages
        self.channels = []
        self.closed = False

    async def subscribe(self, channel):
        self.channels.append(channel)

    async def get_message(self, ignore_subscribe_messages, timeout):
        if self.messages:
            return {"data": json.dumps(self.messages.pop(0)).encode()}
        return None

    async def aclose(self):
        self.closed = True


class FakeRedis:
    def __init__(self, pubsub):
        self._pubsub = pubsub

    def pubsub(self):
        return self._pubsub

    async def aclose(self):
        pass


@pytest.fixture
def pubsub(monkeypatch):
    fake = FakePubSub([{"items": ["a"], "boards": {}, "tab": "", "by": ""}])
    monkeypatch.setattr(views.aioredis.Redis, "from_url", lambda url: FakeRedis(fake))
    return fake


def read(user, chunks):
    """The response and its first `chunks` pieces, then the tab goes away."""

    async def run():
        client = AsyncClient()
        if user:
            await client.aforce_login(user)
        response = await client.get("/api/events/")
        if not response.streaming:
            return response, []
        content = aiter(response.streaming_content)
        received = [await anext(content) for _ in range(chunks)]
        await content.aclose()
        return response, [piece.decode() for piece in received]

    return async_to_sync(run)()


@pytest.mark.django_db(transaction=True)
def test_requires_a_session(pubsub):
    response, _ = read(None, 0)
    assert response.status_code == 403
    assert pubsub.channels == []


@pytest.mark.django_db(transaction=True)
def test_streams_the_users_changes(user, pubsub):
    response, received = read(user, 3)
    assert response.status_code == 200
    assert response["Content-Type"] == "text/event-stream"
    assert response["Cache-Control"] == "no-cache"
    assert pubsub.channels == [f"brainbro:changes:{user.id}"]
    assert received == [
        f"retry: {views.RETRY_MS}\n\n",
        'data: {"items": ["a"], "boards": {}, "tab": "", "by": ""}\n\n',
        ": ping\n\n",
    ]
    assert pubsub.closed
