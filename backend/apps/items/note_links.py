"""
Links a note shows as a card or an embed: `[text](url "card")` or
`[text](url "embed")`. The title is the choice, so the Markdown stays plain
Markdown everywhere else. Their previews are kept as `NoteLink`s, found by the
URL as markdown-it reads it, like images in notes.
"""

from .models import NoteLink
from .note_images import is_remote, markdown

VIEWS = ("card", "embed")
# Only the first ones in a note get a preview.
MAX_LINKS = 50


def previewed_links(body):
    """The URL of each link in `body` shown as a card or embed, in order, once."""
    found = {}
    stack = list(reversed(markdown.parse(body)))
    while stack:
        token = stack.pop()
        if token.type == "link_open" and token.attrGet("title") in VIEWS:
            href = token.attrGet("href") or ""
            if is_remote(href):
                found.setdefault(href, None)
        if token.children:
            stack.extend(reversed(token.children))
    return list(found)[:MAX_LINKS]


def sync_note_links(note):
    """
    Brings the note's link previews in line with its body: removed ones are
    deleted, new ones added as pending. True if there are new ones to fetch.
    """
    urls = previewed_links(note.body)
    links = NoteLink.objects.filter(note=note)
    # Per object, so the images go too.
    for link in links.exclude(url__in=urls):
        link.delete()
    known = set(links.values_list("url", flat=True))
    new = [
        NoteLink(owner=note.owner, note=note, url=url)
        for url in urls
        if url not in known
    ]
    # Two saves at once may both add the same link: one row wins.
    NoteLink.objects.bulk_create(new, ignore_conflicts=True)
    return bool(new)
