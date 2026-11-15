import asyncio

from django.core.handlers.asgi import ASGIHandler
from django.test import override_settings

from apps.core.body_limit import limit_body


def http_scope(length=None):
    headers = [(b"host", b"localhost")]
    if length is not None:
        headers.append((b"content-length", str(length).encode()))
    return {"type": "http", "method": "POST", "path": "/", "headers": headers}


def run(app, scope, chunks):
    """Sends `chunks` as the body; what the app sent back, and what it read."""
    messages = [
        {"type": "http.request", "body": chunk, "more_body": i < len(chunks) - 1}
        for i, chunk in enumerate(chunks)
    ]
    sent = []

    async def receive():
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    asyncio.run(limit_body(app)(scope, receive, send))
    return sent


class Reader:
    """An app that reads the whole body, as Django does, then answers 200."""

    def __init__(self):
        self.body = b""
        self.called = False

    async def __call__(self, scope, receive, send):
        self.called = True
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            self.body += message.get("body", b"")
            if not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})


def status_of(sent):
    return next(m["status"] for m in sent if m["type"] == "http.response.start")


@override_settings(REQUEST_MAX_SIZE=10)
def test_a_declared_length_over_the_limit_is_refused_unread():
    app = Reader()
    sent = run(app, http_scope(11), [b"x" * 11])
    assert status_of(sent) == 413
    assert not app.called


@override_settings(REQUEST_MAX_SIZE=10)
def test_a_body_without_length_stops_being_read_over_the_limit():
    app = Reader()
    sent = run(app, http_scope(), [b"x" * 6, b"x" * 6, b"x" * 6])
    assert status_of(sent) == 413
    assert app.body == b"x" * 6
    # The app gave up: nothing of its own was sent.
    assert len(sent) == 2


@override_settings(REQUEST_MAX_SIZE=10)
def test_a_body_that_lies_about_its_length_is_cut_too():
    app = Reader()
    sent = run(app, http_scope(5), [b"x" * 6, b"x" * 6])
    assert status_of(sent) == 413


@override_settings(REQUEST_MAX_SIZE=10)
def test_bodies_up_to_the_limit_go_through():
    app = Reader()
    sent = run(app, http_scope(10), [b"x" * 4, b"x" * 6])
    assert status_of(sent) == 200
    assert app.body == b"x" * 10


@override_settings(REQUEST_MAX_SIZE=10)
def test_django_answers_nothing_once_cut():
    # Django's own handler ends quietly on the disconnect: the 413 is the
    # only answer.
    sent = run(ASGIHandler(), http_scope(), [b"x" * 6, b"x" * 6])
    assert [m.get("status") for m in sent if m["type"] == "http.response.start"] == [
        413
    ]


def test_the_limit_fits_the_largest_upload(settings):
    assert settings.REQUEST_MAX_SIZE > settings.UPLOAD_MAX_SIZE
    assert settings.REQUEST_MAX_SIZE > settings.IMPORT_MAX_SIZE
