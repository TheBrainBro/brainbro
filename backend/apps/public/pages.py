"""
How a published note, or a blog, shows outside its page: in search results
and when its link is shared (OpenGraph). Each part of a note's is its own
setting or, left empty, a default: its title, the start of its text, its
first image.

The page itself is rendered in the browser, so sites that read the link
(chat apps, search engines) get these tags in the HTML the server sends for
it (see `apps.core.views.spa`).
"""

import re
from dataclasses import dataclass

from django.urls import reverse
from django.utils.html import escape

from apps.accounts.models import Profile
from apps.items.models import Item, NoteImage
from apps.items.note_images import image_sources, markdown
from apps.items.titles import note_title

from .handles import public_handle
from .sites import current_site, site_url

NO_IMAGE = "none"
MAX_DESCRIPTION = 160
WIKILINK = re.compile(r"(?<!!)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]")
TITLE_TAG = re.compile(r"<title>.*?</title>", re.DOTALL)


def excerpt(body, limit=MAX_DESCRIPTION):
    """The start of the note's text as plain words, headings and images left out."""
    words = []
    in_heading = False
    for token in markdown.parse(body):
        if token.type == "heading_open":
            in_heading = True
        elif token.type == "heading_close":
            in_heading = False
        elif token.type == "inline" and not in_heading:
            for child in token.children or []:
                if child.type in ("text", "code_inline"):
                    words.append(child.content)
                elif child.type in ("softbreak", "hardbreak"):
                    words.append(" ")
            words.append(" ")
        if sum(len(word) for word in words) > limit * 2:
            break
    text = WIKILINK.sub(lambda match: match[2] or match[1], "".join(words))
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(".,;:") + "…"


def author_name(note):
    """The display name its owner signs with, or "" when they have none."""
    names = Profile.objects.filter(user_id=note.owner_id).values_list(
        "display_name", flat=True
    )
    return next(iter(names), "")


def default_title(note):
    return note.title or note_title(note.body)


def default_image(note):
    """The note's first image that has a stored copy, if any."""
    ready = {
        image.src: image
        for image in NoteImage.objects.filter(note=note).exclude(image="")
    }
    return next((ready[src] for src in image_sources(note.body) if src in ready), None)


def page_image(note):
    """
    The image its link shows, or None: the one chosen, or (none chosen, or
    taken out of the note) its first.
    """
    return cover_image(note, NoteImage.objects.filter(note=note))


def cover_image(note, images):
    """`page_image`, from the note's images already at hand (a list's notes)."""
    if note.public_image == NO_IMAGE:
        return None
    ready = {image.src: image for image in images if image.image}
    if note.public_image in ready:
        return ready[note.public_image]
    return next((ready[src] for src in image_sources(note.body) if src in ready), None)


def public_avatar_url(profile):
    """Where anyone sees the profile's photo, or None without one."""
    if not profile or not profile.avatar or not profile.handle:
        return None
    path = reverse("public-author-avatar", args=[profile.handle])
    # The file name changes with the photo, so it doubles as a cache buster.
    return f"{path}?v={profile.avatar.name.rsplit('/', 1)[-1]}"


@dataclass
class Preview:
    title: str
    description: str
    image: NoteImage | None


def page_preview(note):
    return Preview(
        title=note.public_title or default_title(note),
        description=note.public_description or excerpt(note.body),
        image=page_image(note),
    )


def public_image_url(note, image, handle):
    path = reverse("public-note-image", args=[handle, note.public_slug, image.id])
    # The file name changes with the file, so it doubles as a cache buster.
    return f"{path}?v={image.image.name.rsplit('/', 1)[-1]}"


def published_note_for_page(**lookup):
    """A published note with what its tags need, or None."""
    return (
        Item.objects.filter(kind=Item.Kind.NOTE, published_at__isnull=False, **lookup)
        .only(
            "id",
            "owner_id",
            "title",
            "body",
            "public_slug",
            "public_title",
            "public_description",
            "public_image",
            "public_listed",
        )
        .first()
    )


def render_tags(
    request, *, title, description, url, meta, author="", feed=None, noindex=False
):
    tags = [
        f"<title>{escape(title)}</title>",
        f'<meta name="description" content="{escape(description)}" />',
        *([f'<meta name="author" content="{escape(author)}" />'] if author else []),
        *(['<meta name="robots" content="noindex" />'] if noindex else []),
        f'<link rel="canonical" href="{escape(url)}" />',
        *(
            [
                '<link rel="alternate" type="application/rss+xml" '
                f'title="{escape(feed)}" href="/rss" />'
            ]
            if feed
            else []
        ),
        *(
            f'<meta property="{name}" content="{escape(value)}" />'
            for name, value in meta.items()
        ),
    ]
    return "\n    ".join(tags)


def note_head_tags(request, note, url):
    """The `<title>` and meta tags for a published note's page, at `url` (absolute)."""
    preview = page_preview(note)
    meta = {
        "og:type": "article",
        "og:title": preview.title,
        "og:description": preview.description,
        "og:url": url,
        "twitter:card": "summary_large_image" if preview.image else "summary",
    }
    if preview.image:
        handle = public_handle(note.owner_id)
        meta["og:image"] = request.build_absolute_uri(
            public_image_url(note, preview.image, handle)
        )
    site = current_site(request)
    return render_tags(
        request,
        title=preview.title,
        description=preview.description,
        url=url,
        meta=meta,
        author=author_name(note),
        feed=site.name if site else None,
        noindex=not note.public_listed,
    )


def site_head_tags(request, site, category=None):
    """The `<title>` and meta tags for a blog's index, or one of its categories."""
    url = site_url(site, f"/c/{category.slug}" if category else "/")
    title = f"{category.name} · {site.name}" if category else site.name
    meta = {
        "og:type": "website",
        "og:title": title,
        "og:description": site.description,
        "og:url": url,
        "twitter:card": "summary",
    }
    return render_tags(
        request,
        title=title,
        description=site.description,
        url=url,
        meta=meta,
        author=site_author(site),
        feed=site.name,
    )


def author_head_tags(request, profile):
    """The `<title>` and meta tags for an author's page, `/@<handle>`."""
    name = profile.display_name or f"@{profile.handle}"
    description = f"Public notes by {name}."
    url = request.build_absolute_uri(f"/@{profile.handle}")
    meta = {
        "og:type": "profile",
        "og:title": name,
        "og:description": description,
        "og:url": url,
        "twitter:card": "summary",
    }
    return render_tags(
        request,
        title=name,
        description=description,
        url=url,
        meta=meta,
        author=profile.display_name,
    )


def site_author(site):
    names = Profile.objects.filter(user_id=site.owner_id).values_list(
        "display_name", flat=True
    )
    return next(iter(names), "")


def with_head_tags(html, tags):
    """index.html with its `<title>` replaced by `tags`."""
    return TITLE_TAG.sub(lambda _: tags, html, count=1)
