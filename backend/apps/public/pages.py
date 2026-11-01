"""
How a published note shows outside its page: in search results and when its
link is shared (OpenGraph). Each part is the note's own setting or, left
empty, a default: its title, the start of its text, its first image.

The page itself is rendered in the browser, so sites that read the link
(chat apps, search engines) get these tags in the HTML the server sends for
`/p/<slug>` (see `apps.core.views.spa`).
"""

import re
from dataclasses import dataclass

from django.urls import reverse
from django.utils.html import escape

from apps.items.models import Item, NoteImage
from apps.items.note_images import image_sources, markdown
from apps.items.titles import note_title

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
    """The image its link shows, or None."""
    if note.public_image == NO_IMAGE:
        return None
    if note.public_image:
        chosen = (
            NoteImage.objects.filter(note=note, src=note.public_image)
            .exclude(image="")
            .first()
        )
        # Taken out of the note: back to the default.
        if chosen:
            return chosen
    return default_image(note)


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


def public_image_url(note, image):
    path = reverse("public-note-image", args=[note.public_slug, image.id])
    # The file name changes with the file, so it doubles as a cache buster.
    return f"{path}?v={image.image.name.rsplit('/', 1)[-1]}"


def head_tags(request, slug):
    """The `<title>` and meta tags for `/p/<slug>`, or None if it isn't published."""
    note = (
        Item.objects.filter(
            kind=Item.Kind.NOTE, published_at__isnull=False, public_slug=slug
        )
        .only(
            "id",
            "owner_id",
            "title",
            "body",
            "public_slug",
            "public_title",
            "public_description",
            "public_image",
        )
        .first()
    )
    if note is None:
        return None
    preview = page_preview(note)
    url = request.build_absolute_uri(f"/p/{slug}")
    meta = {
        "og:type": "article",
        "og:title": preview.title,
        "og:description": preview.description,
        "og:url": url,
        "twitter:card": "summary_large_image" if preview.image else "summary",
    }
    if preview.image:
        meta["og:image"] = request.build_absolute_uri(
            public_image_url(note, preview.image)
        )
    tags = [
        f"<title>{escape(preview.title)}</title>",
        f'<meta name="description" content="{escape(preview.description)}" />',
        f'<link rel="canonical" href="{escape(url)}" />',
        *(
            f'<meta property="{name}" content="{escape(value)}" />'
            for name, value in meta.items()
        ),
    ]
    return "\n    ".join(tags)


def with_head_tags(html, tags):
    """index.html with its `<title>` replaced by `tags`."""
    return TITLE_TAG.sub(lambda _: tags, html, count=1)
