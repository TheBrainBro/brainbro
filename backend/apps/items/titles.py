"""
A name for a note saved without a title, worked out from its body each time
it's shown (`noteTitle` in the frontend): the first H1, or else the first
line, as plain words.
"""

import re

FENCE = re.compile(r"^\s*(```|~~~)")
HEADING = re.compile(r"^ {0,3}#\s+\S")
LINE_MARKERS = re.compile(
    r"^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)?"
)
MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
EMPHASIS = re.compile(r"[*_~=`]")
MAX_TITLE = 80


def first_heading(lines):
    in_code = False
    for line in lines:
        if FENCE.match(line):
            in_code = not in_code
        elif not in_code and HEADING.match(line):
            return line
    return None


def note_title(body, fallback="Note"):
    lines = body.split("\n")
    line = first_heading(lines) or next((line for line in lines if line.strip()), "")
    text = LINE_MARKERS.sub("", line, count=1)
    text = EMPHASIS.sub("", MARKDOWN_LINK.sub(r"\1", text)).strip()
    return text[:MAX_TITLE].strip() or fallback
