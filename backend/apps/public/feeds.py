"""
A blog's feed, sitemap and robots.txt, at the root of its domain. Off a
blog (`request.site` unset) they don't exist.
"""

from django.http import Http404, HttpResponse
from django.utils.feedgenerator import Rss201rev2Feed
from django.utils.html import escape
from django.views.decorators.http import require_GET

from apps.items.titles import note_title

from .pages import excerpt, site_author
from .sites import current_site, listed_notes, site_notes, site_url

FEED_SIZE = 50


def blog(request):
    site = current_site(request)
    if site is None:
        raise Http404
    return site


def newest_notes(site):
    return (
        listed_notes(site_notes(site))
        .only("id", "title", "body", "public_slug", "published_at", "edited_at")
        .order_by("-published_at")
    )


@require_GET
def rss(request):
    """The blog's last notes, newest first, for feed readers."""
    site = blog(request)
    author = site_author(site)
    feed = Rss201rev2Feed(
        title=site.name,
        link=site_url(site),
        description=site.description or site.name,
        feed_url=site_url(site, "/rss"),
        author_name=author or None,
    )
    for note in newest_notes(site)[:FEED_SIZE]:
        link = site_url(site, f"/{note.public_slug}")
        feed.add_item(
            title=note.title or note_title(note.body),
            link=link,
            unique_id=link,
            description=excerpt(note.body),
            pubdate=note.published_at,
            updateddate=note.edited_at,
            author_name=author or None,
        )
    # Plain XML, not `application/rss+xml`: browsers show it instead of
    # downloading it, and feed readers take either.
    return HttpResponse(
        feed.writeString("utf-8"), content_type="application/xml; charset=utf-8"
    )


@require_GET
def sitemap(request):
    """Every page of the blog, for search engines."""
    site = blog(request)
    urls = [f"<url><loc>{escape(site_url(site))}</loc></url>"]
    for note in newest_notes(site):
        changed = note.edited_at or note.published_at
        urls.append(
            f"<url><loc>{escape(site_url(site, f'/{note.public_slug}'))}</loc>"
            f"<lastmod>{changed.date().isoformat()}</lastmod></url>"
        )
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(urls)
        + "</urlset>\n"
    )
    return HttpResponse(body, content_type="application/xml; charset=utf-8")


@require_GET
def robots(request):
    site = blog(request)
    body = f"User-agent: *\nAllow: /\n\nSitemap: {site_url(site, '/sitemap.xml')}\n"
    return HttpResponse(body, content_type="text/plain; charset=utf-8")
