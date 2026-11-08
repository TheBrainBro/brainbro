"""
Blogs on their owners' own domains. BrainBro routes by the host a request
arrives with (`SiteMiddleware`): the server's own hostnames (`APP_HOSTS`)
get the app, and a verified site's hostname gets that blog, whatever brought
the request there (a reverse proxy issuing certificates on demand, a tunnel).
"""

import re
from collections import defaultdict

import dns.exception
import dns.resolver
from django.conf import settings
from django.http import HttpResponseBadRequest
from django.http.request import split_domain_port, validate_host

from apps.items.models import CollectionItem, Item

from .handles import public_handle
from .models import Site

# Labels of letters, digits and inner hyphens, and at least two of them.
HOSTNAME = re.compile(
    r"(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})"
)
DNS_TIMEOUT = 5  # seconds
SITE_URLCONF = "config.site_urls"


def normalize_hostname(value):
    """
    `Blog.Example.com.` as `blog.example.com`, punycode for other scripts;
    "" if it isn't a domain.
    """
    value = value.strip().lower().rstrip(".")
    try:
        value = value.encode("idna").decode("ascii")
    except UnicodeError:
        return ""
    return value if HOSTNAME.fullmatch(value) else ""


def is_app_host(host):
    return validate_host(host, settings.APP_HOSTS)


def verified_sites():
    return Site.objects.filter(status=Site.Status.VERIFIED)


class SiteMiddleware:
    """
    Sends each request to the app or to a blog by its host. Unknown hosts
    get 400, as `ALLOWED_HOSTS` would give them (it is `*`: this checks).
    A blog has URLs of its own (`config.site_urls`), so nothing of the app
    is reachable from its domain, and cookies are dropped: no session ever
    reaches the app from there.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        host, _ = split_domain_port(request._get_raw_host())
        request.site = None
        if not is_app_host(host):
            site = verified_sites().filter(hostname=host).first() if host else None
            if site is None:
                return HttpResponseBadRequest("Unknown host.")
            request.META.pop("HTTP_COOKIE", None)
            request.urlconf = SITE_URLCONF
            request.site = site
        return self.get_response(request)


def current_site(request):
    """The blog this request is for, or None for the app."""
    return getattr(request, "site", None)


def site_notes(site):
    """The published notes on `site`: those filed in its collection."""
    if site.collection_id is None:
        return Item.objects.none()
    return Item.objects.filter(
        kind=Item.Kind.NOTE,
        published_at__isnull=False,
        owner_id=site.owner_id,
        collections=site.collection_id,
    )


def site_url(site, path="/"):
    """
    A blog's address: HTTPS on its own domain in production; in development,
    `http://<hostname>:8000`, where Django serves it (`SITE_SCHEME`, `SITE_PORT`).
    """
    port = f":{settings.SITE_PORT}" if settings.SITE_PORT else ""
    return f"{settings.SITE_SCHEME}://{site.hostname}{port}{path}"


def public_urls(notes, current_site=None):
    """
    Where each of these published notes lives, by id: its blog if it is on
    one (`https://<hostname>/<slug>`), `/@<handle>/<slug>` on the server
    otherwise. Read on `current_site`, its own notes are `/<slug>` and those
    on no blog have no address there (their links read as plain text).
    """
    urls = {}
    by_owner = defaultdict(list)
    for note in notes:
        by_owner[note.owner_id].append(note)
    for owner_id, owned in by_owner.items():
        sites = list(
            verified_sites()
            .filter(owner_id=owner_id, collection__isnull=False)
            .order_by("created_at")
        )
        placed = defaultdict(set)
        if sites:
            rows = CollectionItem.objects.filter(
                item__in=[note.id for note in owned],
                collection_id__in=[site.collection_id for site in sites],
            ).values_list("item_id", "collection_id")
            for item_id, collection_id in rows:
                placed[item_id].add(collection_id)
        handle = None
        for note in owned:
            collections = placed[note.id]
            if current_site is not None and current_site.collection_id in collections:
                urls[note.id] = f"/{note.public_slug}"
                continue
            site = next((s for s in sites if s.collection_id in collections), None)
            if site:
                urls[note.id] = site_url(site, f"/{note.public_slug}")
            elif current_site is None:
                handle = handle or public_handle(owner_id)
                urls[note.id] = f"/@{handle}/{note.public_slug}"
            else:
                urls[note.id] = None
    return urls


def public_url(note):
    """Where a published note lives: on its blog (absolute) or `/@<handle>/<slug>`."""
    return public_urls([note])[note.id]


def txt_values(name):
    """The TXT records at `name`, as strings; none if it has none or DNS fails."""
    try:
        answer = dns.resolver.resolve(name, "TXT", lifetime=DNS_TIMEOUT)
    except dns.exception.DNSException:
        return set()
    return {b"".join(record.strings).decode(errors="replace") for record in answer}
