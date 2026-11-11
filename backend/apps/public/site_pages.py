"""
A blog's pages on its own domain, whole from the server: search engines and
chat apps read the text in the HTML, and they need no JavaScript to open.
"""

import json
import re
from pathlib import Path

from django.conf import settings
from django.http import Http404
from django.shortcuts import render
from django.utils import dateformat, timezone, translation
from django.utils.cache import patch_vary_headers
from django.utils.html import escape, format_html
from django.utils.safestring import mark_safe
from django.utils.translation.trans_real import parse_accept_lang_header
from django.views.decorators.http import require_safe

from apps.items.titles import note_title

from .handles import public_handle
from .note_html import render_note, without_title
from .pages import (
    note_head_tags,
    public_site_avatar_url,
    site_author,
    site_head_tags,
)
from .sites import current_site, site_categories, site_notes, site_url
from .views import (
    linked_notes,
    listed_categories,
    note_list,
    note_summaries,
    public_images,
    public_links,
)

# The app's words for these pages (`frontend/src/i18n`), checked against them.
MESSAGES = json.loads((Path(__file__).parent / "messages.json").read_text())
DEFAULT_LANGUAGE = "en"
DAY_FORMATS = {"en": "F j, Y", "es": r"j \d\e F \d\e Y"}
STYLESHEET = re.compile(r'<link rel="stylesheet"[^>]*href="([^"]+)"')
CATEGORY_PAGE = re.compile(r"c/(?P<slug>[a-z0-9-]+)/?")
NOTE_PAGE = re.compile(r"(?P<slug>[a-z0-9-]+)/?")
BRAND = mark_safe(
    '<a href="https://brainbro.app" class="font-medium hover:text-accent-700 '
    'dark:hover:text-accent-300">BrainBro</a>'
)
MAX_LISTED = 200
MORE_NOTES = 3


def visitor_language(request):
    """The browser's first language the blog's pages speak, English otherwise."""
    header = request.headers.get("Accept-Language", "")
    for tag, _ in parse_accept_lang_header(header):
        base = tag.split("-")[0]
        if base in MESSAGES:
            return base
    return DEFAULT_LANGUAGE


def day(moment, language):
    """A day, as in "June 3, 2026", in the language shown."""
    with translation.override(language):
        return dateformat.format(timezone.localtime(moment), DAY_FORMATS[language])


def stylesheet_url():
    """The app's stylesheet, from the frontend build; None before there is one."""
    index = settings.FRONTEND_DIST_DIR / "index.html"
    if not index.exists():
        return None
    match = STYLESHEET.search(index.read_text())
    return match[1] if match else None


def page_context(request, site):
    """What every page of the blog shows around its content."""
    language = visitor_language(request)
    text = MESSAGES[language]
    name = site.name or site.hostname
    return {
        "language": language,
        "text": text,
        "stylesheet": stylesheet_url(),
        "name": name,
        "initial": name.lstrip("@")[:1] or "?",
        "avatar_url": public_site_avatar_url(site),
        "powered_by": (
            format_html(text["public"]["poweredBy"], brand=BRAND)
            if site.powered_by
            else ""
        ),
    }


def listed_cards(notes, site, language):
    """Published notes as the cards of a list."""
    cards = note_summaries(list(notes), site)
    for card in cards:
        card["day"] = day(card["published_at"], language)
    return cards


def respond(request, template, context, status=200):
    response = render(request, template, context, status=status)
    # What a page says around the post follows the visitor's language.
    patch_vary_headers(response, ["Accept-Language"])
    return response


def index_page(request, site, category=None):
    context = page_context(request, site)
    author = site_author(site)
    title = site.name
    tabs = [
        {
            "name": context["text"]["public"]["allPosts"],
            "url": "/",
            "current": category is None,
        },
        *(
            {
                "name": each.name,
                "url": f"/c/{each.slug}",
                "current": category is not None and each.slug == category.slug,
            }
            for each in listed_categories(site)
        ),
    ]
    context.update(
        # nosemgrep: avoid-mark-safe -- every value in the tags is escaped
        head=mark_safe(site_head_tags(request, site, category)),
        detail=author if site.show_author and author and author != title else "",
        description=site.description,
        links=site.links,
        tabs=tabs if len(tabs) > 1 else [],
        notes=listed_cards(
            note_list(site_notes(site, category))[:MAX_LISTED],
            site,
            context["language"],
        ),
    )
    return respond(request, "public/site_index.html", context)


def note_page(request, site, slug):
    note = (
        site_notes(site)
        .filter(public_slug=slug)
        .prefetch_related("note_images", "note_links")
        .first()
    )
    if note is None:
        raise Http404
    context = page_context(request, site)
    language = context["language"]
    text = context["text"]
    handle = public_handle(site.owner_id)
    title = note.title or note_title(note.body)
    edited = (
        note.edited_at
        if note.edited_at and note.edited_at > note.published_at
        else None
    )
    more = listed_cards(
        note_list(site_notes(site)).exclude(public_slug=slug)[:MORE_NOTES],
        site,
        language,
    )
    url = site_url(site, f"/{note.public_slug}")
    context.update(
        # nosemgrep: avoid-mark-safe -- every value in the tags is escaped
        head=mark_safe(note_head_tags(request, note, url)),
        title=title,
        published_at=note.published_at,
        published_day=day(note.published_at, language),
        updated=(
            format_html(
                text["public"]["updated"],
                date=format_html(
                    '<time datetime="{}">{}</time>',
                    edited.isoformat(),
                    day(edited, language),
                ),
            )
            if edited
            else ""
        ),
        # nosemgrep: avoid-mark-safe -- render_note sanitizes with nh3
        html=mark_safe(
            render_note(
                without_title(note.body, title),
                images=public_images(note, handle),
                links=public_links(note, handle),
                notes=linked_notes(request, note),
                messages=text,
            )
        ),
        more=more,
        more_title=text["public"]["moreFrom"].replace(
            "{name}", site_author(site) or f"@{handle}"
        ),
    )
    return respond(request, "public/site_note.html", context)


@require_safe
def site_page(request, path=""):
    """A blog's index, one of its categories or one of its notes."""
    site = current_site(request)
    if path == "":
        return index_page(request, site)
    if match := CATEGORY_PAGE.fullmatch(path):
        category = next(
            (c for c in site_categories(site) if c.slug == match["slug"]), None
        )
        if category is None:
            raise Http404
        return index_page(request, site, category)
    if match := NOTE_PAGE.fullmatch(path):
        return note_page(request, site, match["slug"])
    raise Http404


def not_found(request, exception=None):
    """Any address a blog doesn't have: a page for people, a 404 for crawlers."""
    site = current_site(request)
    context = page_context(request, site)
    # nosemgrep: avoid-mark-safe -- fixed markup around escaped text
    context["head"] = mark_safe(
        f"<title>{escape(context['text']['public']['missing'])}</title>\n"
        '    <meta name="robots" content="noindex" />'
    )
    return respond(request, "public/site_missing.html", context, status=404)
