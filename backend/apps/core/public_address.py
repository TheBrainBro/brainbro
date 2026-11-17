"""
The server's public address, set by an admin in Settings, Server, Public
address: where people outside reach it, e.g. `https://brain.example.com`.

Every link that leaves the instance starts with it (invitations, password
resets, public pages, what the MCP tools return); without one, with the
address the request came in on. Its host also serves the app
(`apps.public.sites`), and when it is HTTPS, requests on that host trust the
proxy's `X-Forwarded-Proto`. So a tunnel works without any environment
variable, which the Umbrel app can't set.

The connections the browser makes to where it already is (OAuth discovery,
the MCP `Origin` check) keep using the request's own address.
"""

from urllib.parse import urljoin, urlsplit

from django.apps import apps
from django.db import DatabaseError


def saved():
    """The public address, `https://brain.example.com`, or "" without one."""
    # By name: the middleware imports this module before models are ready.
    ServerSettings = apps.get_model("core", "ServerSettings")
    try:
        row = ServerSettings.objects.only("public_url").first()
    except DatabaseError:
        # Before the first migration: there is none.
        return ""
    return row.public_url if row else ""


def save(public_url):
    ServerSettings = apps.get_model("core", "ServerSettings")
    ServerSettings.objects.update_or_create(
        singleton=True, defaults={"public_url": public_url}
    )


def host():
    """The public address's hostname, without port; "" without one."""
    return urlsplit(saved()).hostname or ""


def is_https_host(hostname):
    """Whether `hostname` is the public address's, and that address is HTTPS."""
    parts = urlsplit(saved())
    return parts.scheme == "https" and bool(hostname) and parts.hostname == hostname


def is_for_app(request):
    """Whether the request is for the app, not for a blog or the embed host."""
    return getattr(request, "site", None) is None and not getattr(
        request, "embed", False
    )


def base_url(request):
    """
    Where links to the app start, without the trailing slash: the public
    address, or the request's own. A blog's or the embed host's requests
    keep their own: their links point there.
    """
    public = saved() if is_for_app(request) else ""
    return public or request.build_absolute_uri("/").rstrip("/")


def absolute(request, url):
    """`/@ana/trip` as `https://<public address>/@ana/trip`; absolute URLs as is."""
    return urljoin(f"{base_url(request)}/", url)


def display_host(request):
    """The host links start with, as people read it: `brain.example.com`."""
    return urlsplit(base_url(request)).netloc
