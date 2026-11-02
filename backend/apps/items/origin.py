"""
Who is making a change, and through what: the user or a connected app (an
assistant signed in with OAuth, or a personal token), on the web, Telegram,
MCP, the API or an import. Items record it when they are created and when
their content is edited (see `Item.save` and `Item.mark_edited`).

Requests are worked out from how they authenticated (`OriginMiddleware`);
the MCP endpoint, Telegram and imports say it themselves (`acting`).
Anything else, like a background task filling in a preview, has no origin.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from django.db import models

from apps.accounts.models import ApiToken


class Source(models.TextChoices):
    # Items from before origins were recorded.
    UNKNOWN = "", "Unknown"
    WEB = "web", "Web"
    TELEGRAM = "telegram", "Telegram"
    MCP = "mcp", "MCP"
    API = "api", "API"
    IMPORT = "import", "Import"


@dataclass(frozen=True)
class Origin:
    # The app's name; empty for the user.
    by: str = ""
    via: str = Source.UNKNOWN


_acting: ContextVar[Origin | None] = ContextVar("acting", default=None)
_request: ContextVar = ContextVar("origin_request", default=None)


def app_name(token):
    """The connected app's name, or the personal token's."""
    return token.client.name if token.client_id else token.name


@contextmanager
def acting(via, by=""):
    """What changes inside is made by `by` (the user when empty) through `via`."""
    token = _acting.set(Origin(by=by, via=via))
    try:
        yield
    finally:
        _acting.reset(token)


def current():
    origin = _acting.get()
    if origin is not None:
        return origin
    request = _request.get()
    if request is None:
        return Origin()
    # DRF puts the token it authenticated with on the request.
    token = getattr(request, "auth", None)
    if isinstance(token, ApiToken):
        return Origin(by=app_name(token), via=Source.API)
    return Origin(via=Source.WEB)


class OriginMiddleware:
    """Changes a request makes come from the web app, or from a token's app."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _request.set(request)
        try:
            return self.get_response(request)
        finally:
            _request.reset(token)
