"""
Tells a user's open tabs what changed, as it happens, so they refetch what
they show (see `views.stream`). Any process can tell them, the api or the
worker: messages go through Redis pub/sub, one channel per user.

What changes while a request or a task runs is gathered (`collect`) and goes
out as one message when it ends; anything else goes out on its own. Either
way, only once the transaction commits.
"""

import json
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import cache

import redis
from django.conf import settings
from django.db import transaction

logger = logging.getLogger(__name__)

# The longest tab id taken from a request: it is only echoed back.
TAB_MAX_LENGTH = 64


def channel(owner_id):
    return f"brain:changes:{owner_id}"


@cache
def connection():
    return redis.Redis.from_url(
        settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2
    )


def publish(owner_id, message):
    try:
        connection().publish(channel(owner_id), json.dumps(message))
    except redis.RedisError:
        # The change is saved: tabs catch up when they reconnect or reload.
        logger.warning("Couldn't tell open tabs about a change.", exc_info=True)


@dataclass
class Changes:
    """
    What changed, by owner: items (their ids) and boards (their revision).
    A message with neither still says lists changed (collections, order).

    `tab`: the tab whose request made the changes; it already shows them.
    `by`: the assistant that made them, for the note editor to name it.
    """

    tab: str = ""
    by: str = ""
    owners: dict = field(default_factory=dict)

    def add(self, owner_id, items=(), boards=None):
        change = self.owners.setdefault(str(owner_id), {"items": set(), "boards": {}})
        change["items"].update(str(item_id) for item_id in items)
        for board_id, revision in (boards or {}).items():
            known = change["boards"].get(str(board_id), 0)
            change["boards"][str(board_id)] = max(known, revision)

    def send(self):
        for owner_id, change in self.owners.items():
            message = {
                "items": sorted(change["items"]),
                "boards": change["boards"],
                "tab": self.tab,
                "by": self.by,
            }
            transaction.on_commit(
                lambda owner_id=owner_id, message=message: publish(owner_id, message)
            )
        self.owners = {}


_collecting: ContextVar[Changes | None] = ContextVar("collecting", default=None)


@contextmanager
def collect(tab="", by=""):
    """Gathers what changes inside, to send it as one message per owner at the end."""
    changes = Changes(tab=tab[:TAB_MAX_LENGTH], by=by)
    token = _collecting.set(changes)
    try:
        yield changes
    finally:
        _collecting.reset(token)
        changes.send()


def made_by():
    """The assistant making the changes being collected, if one is."""
    changes = _collecting.get()
    return changes.by if changes is not None else ""


def changed(owner_id, items=(), boards=None):
    """`owner_id`'s items (ids) or boards ({id: revision}) changed, or their lists."""
    changes = _collecting.get()
    if changes is not None:
        changes.add(owner_id, items, boards)
        return
    changes = Changes()
    changes.add(owner_id, items, boards)
    changes.send()


def items_changed(items):
    """The items in a queryset changed (whoever owns them); before a delete."""
    for owner_id, item_id in items.values_list("owner_id", "id"):
        changed(owner_id, items=[item_id])
