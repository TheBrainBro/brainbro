"""
`/api/live/notes/<id>`: the WebSocket a note's editor keeps open to edit it
live with every other session that has it open (see `rooms`), in
y-websocket's binary protocol.

Django doesn't serve WebSockets: `config.asgi` sends them here. Like the API,
it needs the session cookie, sent from this site (Origin), and a note the
user can open: today, one of their own. It is checked again while the
connection stays open (`RECHECK_SECONDS`).
"""

import asyncio
import logging
import re
from importlib import import_module
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth import get_user
from django.http import HttpRequest, parse_cookie
from django.http.request import split_domain_port, validate_host

from apps.items.models import Item

from .rooms import Rooms, Session, in_thread

logger = logging.getLogger(__name__)

PATH = re.compile(r"^/api/live/notes/(?P<id>[0-9a-f-]{36})$")
# The WebSocket close code for a connection that may not open the note. 44xx
# codes tell y-websocket not to reconnect, so it is sent once accepted: a
# refusal before that reaches the browser as a failed connection, retried.
CLOSE_FORBIDDEN = 4403
# A message the protocol can't read.
CLOSE_INVALID = 1007
# How often an open connection checks that it may still open the note: signed
# out, a changed password or a disabled account end it within this long.
RECHECK_SECONDS = 60

rooms = Rooms()


def header(scope, name):
    for key, value in scope["headers"]:
        if key == name:
            return value.decode("latin-1")
    return ""


def allowed_host(scope):
    """The Host is the app's (never a blog's), as `SiteMiddleware` checks for HTTP."""
    hosts = settings.APP_HOSTS
    domain, _ = split_domain_port(header(scope, b"host"))
    return bool(domain) and validate_host(domain, hosts)


def same_origin(scope):
    """
    Sent from a page of this site. A page elsewhere could otherwise open the
    socket with the user's cookie; tools that aren't browsers send no Origin.
    """
    origin = header(scope, b"origin")
    return not origin or urlsplit(origin).netloc == header(scope, b"host")


def user_of(scope):
    request = HttpRequest()
    cookies = parse_cookie(header(scope, b"cookie"))
    # nosemgrep: non-literal-import -- the session engine from settings, not user input
    engine = import_module(settings.SESSION_ENGINE)
    request.session = engine.SessionStore(cookies.get(settings.SESSION_COOKIE_NAME))
    return get_user(request)


def can_open(scope, note_id):
    user = user_of(scope)
    if not user.is_authenticated:
        return False
    return Item.objects.filter(id=note_id, owner=user, kind=Item.Kind.NOTE).exists()


async def keep_checking(scope, note_id, session):
    """Closes `session` once its sign-in no longer opens the note."""
    while True:
        await asyncio.sleep(RECHECK_SECONDS)
        if not await in_thread(can_open)(scope, note_id):
            session.close(CLOSE_FORBIDDEN)
            return


async def websocket(scope, receive, send):
    event = await receive()
    if event["type"] != "websocket.connect":
        return
    match = PATH.match(scope["path"])
    if (
        match is None
        or not allowed_host(scope)
        or not same_origin(scope)
        or not await in_thread(can_open)(scope, match["id"])
    ):
        await send({"type": "websocket.accept"})
        await send({"type": "websocket.close", "code": CLOSE_FORBIDDEN})
        return
    await send({"type": "websocket.accept"})

    session = Session(send)
    writer = asyncio.create_task(session.write())
    checker = asyncio.create_task(keep_checking(scope, match["id"], session))
    room = None
    try:
        room = await rooms.join(match["id"], session)
        while True:
            event = await receive()
            if event["type"] == "websocket.disconnect" or session.closed:
                break
            if event.get("bytes"):
                await room.receive(session, event["bytes"])
    except Item.DoesNotExist:
        session.close(CLOSE_FORBIDDEN)
    except Exception:
        logger.warning("Closed a note's connection on a bad message.", exc_info=True)
        session.close(CLOSE_INVALID)
    finally:
        checker.cancel()
        if room is not None:
            await rooms.leave(room, session)
        session.close()
        await writer
