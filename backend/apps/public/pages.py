"""
How a published note, or a blog, shows outside its page: in search results
and when its link is shared (OpenGraph). Each part of a note's is its own
setting or, left empty, a default: its title, the start of its text, its
first image.

Sites that read the link (chat apps, search engines) get these tags in the
HTML the server sends for it (`apps.core.views.spa` on the app, and
`apps.public.site_pages` on a blog).
"""

import json
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
from .social_images import SIZE as SOCIAL_IMAGE_SIZE

NO_IMAGE = "none"
MAX_DESCRIPTION = 160
WIKILINK = re.compile(r"(?<!!)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]")
TITLE_TAG = re.compile(r"<title>.*?</title>", re.DOTALL)
JSON_SCRIPT_ESCAPES = {ord("<"): "\\u003C", ord(">"): "\\u003E", ord("&"): "\\u0026"}


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


def site_social_image_url(request, site):
    """The blog's social image as an absolute URL, or None without one."""
    if not site.social_image:
        return None
    # The file name changes with the file, so it doubles as a cache buster.
    version = site.social_image.name.rsplit("/", 1)[-1]
    return request.build_absolute_uri(
        f"{reverse('public-site-social-image')}?v={version}"
    )


def public_avatar_url(profile):
    """Where anyone sees the profile's photo, or None without one."""
    if not profile or not profile.avatar or not profile.handle:
        return None
    path = reverse("public-author-avatar", args=[profile.handle])
    # The file name changes with the photo, so it doubles as a cache buster.
    return f"{path}?v={profile.avatar.name.rsplit('/', 1)[-1]}"


def public_site_avatar_url(site):
    """Where anyone sees the blog's photo: its own, or else its owner's."""
    if site.avatar:
        path = reverse("public-site-avatar")
        # The file name changes with the photo, so it doubles as a cache buster.
        return f"{path}?v={site.avatar.name.rsplit('/', 1)[-1]}"
    return public_avatar_url(Profile.objects.filter(user_id=site.owner_id).first())


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
            "published_at",
            "edited_at",
        )
        .first()
    )


def json_ld_tag(data):
    """Structured data, safe inside a `<script>`."""
    text = json.dumps(data, ensure_ascii=False).translate(JSON_SCRIPT_ESCAPES)
    return f'<script type="application/ld+json">{text}</script>'


def meta_tag(name, value):
    # X reads its own tags by `name`; Open Graph's go by `property`.
    attribute = "name" if name.startswith("twitter:") else "property"
    return f'<meta {attribute}="{name}" content="{escape(value)}" />'


def with_image(meta, url, size=None):
    """`meta` showing the image at `url` (of `size`, if known) when shared."""
    meta["og:image"] = url
    if size:
        meta["og:image:width"], meta["og:image:height"] = size
    meta["twitter:image"] = url
    meta["twitter:card"] = "summary_large_image"


def render_tags(
    request,
    *,
    title,
    description,
    url,
    meta,
    author="",
    feed=None,
    noindex=False,
    structured=None,
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
        *(meta_tag(name, value) for name, value in meta.items()),
        *([json_ld_tag(structured)] if structured else []),
    ]
    return "\n    ".join(tags)


def note_head_tags(request, note, url):
    """The `<title>` and meta tags for a published note's page, at `url` (absolute)."""
    preview = page_preview(note)
    site = current_site(request)
    # A note can be all pictures, with no words to start from.
    description = preview.description or (site_description(site) if site else "")
    meta = {
        "og:type": "article",
        "og:title": preview.title,
        "og:description": description,
        "og:url": url,
        "twitter:card": "summary",
    }
    if site:
        meta["og:site_name"] = blog_name(site)
    edited = (
        note.edited_at
        if note.edited_at and note.edited_at > note.published_at
        else None
    )
    author = site_author(site) if site else author_name(note)
    meta["article:published_time"] = note.published_at.isoformat()
    structured = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": preview.title,
        "description": description,
        "url": url,
        "datePublished": note.published_at.isoformat(),
    }
    if edited:
        meta["article:modified_time"] = edited.isoformat()
        structured["dateModified"] = edited.isoformat()
    if author:
        structured["author"] = {"@type": "Person", "name": author}
        if site and site.author_url:
            structured["author"]["url"] = site.author_url
    if preview.image:
        handle = public_handle(note.owner_id)
        image_url = request.build_absolute_uri(
            public_image_url(note, preview.image, handle)
        )
        with_image(meta, image_url)
        structured["image"] = image_url
    elif site and note.public_image != NO_IMAGE:
        # For the link only: the blog's image doesn't illustrate the post, so
        # the structured data doesn't claim it does.
        if fallback := site_social_image_url(request, site):
            with_image(meta, fallback, SOCIAL_IMAGE_SIZE)
    return render_tags(
        request,
        title=preview.title,
        description=description,
        url=url,
        meta=meta,
        author=author,
        feed=site.name if site else None,
        noindex=not note.public_listed,
        structured=structured,
    )


def site_head_tags(request, site, category=None):
    """The `<title>` and meta tags for a blog's index, or one of its categories."""
    url = site_url(site, f"/c/{category.slug}" if category else "/")
    name = blog_name(site)
    title = f"{category.name} · {name}" if category else name
    description = site_description(site)
    meta = {
        "og:type": "website",
        "og:site_name": name,
        "og:title": title,
        "og:description": description,
        "og:url": url,
        "twitter:card": "summary",
    }
    if image_url := site_social_image_url(request, site):
        with_image(meta, image_url, SOCIAL_IMAGE_SIZE)
    return render_tags(
        request,
        title=title,
        description=description,
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


def blog_name(site):
    return site.name or site.hostname


def site_description(site):
    """Its blurb, or else one made up: its pages never describe themselves as empty."""
    return site.description or f"Posts from {blog_name(site)}."


def site_author(site):
    """Who signs the blog: its own author, or else its owner's display name."""
    if site.author:
        return site.author
    names = Profile.objects.filter(user_id=site.owner_id).values_list(
        "display_name", flat=True
    )
    return next(iter(names), "")


def with_head_tags(html, tags):
    """index.html with its `<title>` replaced by `tags`."""
    return TITLE_TAG.sub(lambda _: tags, html, count=1)
