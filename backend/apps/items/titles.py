"""
A name for a note saved without a title, worked out from its body each time
it's shown (`noteTitle` in the frontend): its first line, as plain words.
"""

import re

LINE_MARKERS = re.compile(
    r"^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)?"
)
MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
EMPHASIS = re.compile(r"[*_~=`]")
MAX_TITLE = 80


def note_title(body, fallback="Note"):
    line = next((line for line in body.split("\n") if line.strip()), "")
    text = LINE_MARKERS.sub("", line, count=1)
    text = EMPHASIS.sub("", MARKDOWN_LINK.sub(r"\1", text)).strip()
    return text[:MAX_TITLE].strip() or fallback


def linkable_titles(notes):
    """
    The titles `[[Title]]` finds notes by, in the order they are tried: saved
    titles first, then the ones untitled notes get from their body. Matching is
    case-insensitive, and the first note with a title is the one found.
    """
    saved = [(note.id, note.title) for note in notes if note.title]
    shown = [
        (note.id, title)
        for note in notes
        if not note.title and (title := note_title(note.body, fallback=""))
    ]
    return saved + shown


def wikilink_target(target):
    """The title a link points to: `Folder/Title.md` and `Title` both mean Title."""
    return target.strip().rsplit("/", 1)[-1].removesuffix(".md")
