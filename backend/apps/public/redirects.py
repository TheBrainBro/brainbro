"""
Permanent redirects on a blog: an old address (`/mi-viaje`, from where its
posts lived before) answers 301 to a new one. They are checked before the
blog's own pages, and can't take an address its own pages use.
"""

from urllib.parse import unquote, urlsplit

from django.db import transaction
from django.http import HttpResponsePermanentRedirect

from .models import Redirect
from .sites import current_site, site_notes

MAX_PATH = 2048
# What a blog serves itself (`config.site_urls`).
RESERVED_PATHS = {"/", "/rss", "/sitemap.xml", "/robots.txt"}
RESERVED_PREFIXES = ("/api/", "/c/")


class InvalidRedirect(ValueError):
    pass


def normalize_path(value):
    """
    `https://blog.example.com/Mi%20viaje/?a=1` as `/Mi viaje`: the path alone,
    decoded as Django reads it, without a trailing slash.
    """
    path = unquote(urlsplit(value.strip()).path)
    if not path.startswith("/"):
        path = f"/{path}"
    return path.rstrip("/") or "/"


def is_reserved(path):
    return (
        path in RESERVED_PATHS or path == "/api" or path.startswith(RESERVED_PREFIXES)
    )


def clean_target(value):
    """A path on the blog (`/viaje-a-viena`) or an http(s) URL, as given."""
    value = value.strip()
    parts = urlsplit(value)
    if parts.scheme in ("http", "https") and parts.netloc:
        return value
    if value.startswith("/") and not value.startswith("//") and not parts.scheme:
        return value
    raise InvalidRedirect(
        f"{value!r} isn't a path on the blog (like /new-post) or an http(s) URL."
    )


def save_redirects(site, pairs):
    """
    Saves `[(old, new)]` on `site`, all or none: an old path already there
    points to the new target. Raises InvalidRedirect saying which is wrong.
    """
    cleaned = {}
    for old, new in pairs:
        path = normalize_path(old)
        if len(path) > MAX_PATH:
            raise InvalidRedirect(f"{old!r} is too long.")
        if is_reserved(path):
            raise InvalidRedirect(
                f"{path!r} is one of the blog's own addresses, and can't redirect."
            )
        target = clean_target(new)
        if len(target) > MAX_PATH:
            raise InvalidRedirect(f"{new!r} is too long.")
        if target.startswith("/") and normalize_path(target) == path:
            raise InvalidRedirect(f"{path!r} would redirect to itself.")
        cleaned[path] = target
    # A published post there would never be seen again.
    slugs = {path[1:] for path in cleaned if "/" not in path[1:]}
    live = (
        site_notes(site)
        .filter(public_slug__in=slugs)
        .values_list("public_slug", flat=True)
    )
    if taken := sorted(live):
        raise InvalidRedirect(
            f"A published post lives at /{taken[0]}: it can't redirect elsewhere."
        )
    with transaction.atomic():
        for path, target in cleaned.items():
            Redirect.objects.update_or_create(
                site=site,
                path=path,
                defaults={"owner_id": site.owner_id, "target": target},
            )
    return Redirect.objects.filter(site=site, path__in=cleaned)


def redirect_target(site, request_path):
    """Where a request for `request_path` on `site` goes, or None."""
    path = normalize_path(request_path)
    if is_reserved(path):
        return None
    return (
        Redirect.objects.filter(site=site, path=path)
        .values_list("target", flat=True)
        .first()
    )


class RedirectMiddleware:
    """On a blog's domain, an old address answers 301 to its new one."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        site = current_site(request)
        if site is not None and (target := redirect_target(site, request.path_info)):
            return HttpResponsePermanentRedirect(target)
        return self.get_response(request)
