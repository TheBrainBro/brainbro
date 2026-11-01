"""
A note's text changed as edits on its shared document: only what differs, so
they merge with what others are writing around them.

pycrdt counts text positions in UTF-8 bytes, Yjs clocks in UTF-16 units and
Python in characters: positions are worked out in characters and converted.
"""

from difflib import SequenceMatcher

from pycrdt import Decoder, Doc, Text

# The shared text's name in the document; the browser binds the same one.
TEXT = "body"


def text_of(doc: Doc) -> Text:
    return doc.get(TEXT, type=Text)


def utf16_length(value):
    return len(value.encode("utf-16-le")) // 2


# Changed blocks up to this many characters are compared character by
# character; bigger ones are only trimmed to what differs at their ends.
CHARACTER_DIFF_LIMIT = 5000
# Text this short left alone between two changes merges them into one, so an
# unrelated rewrite isn't cut into scraps around stray matching letters.
MIN_KEPT = 4


def common_ends(old, new):
    """How many characters `old` and `new` share at the start and at the end."""
    limit = min(len(old), len(new))
    prefix = 0
    while prefix < limit and old[prefix] == new[prefix]:
        prefix += 1
    suffix = 0
    while suffix < limit - prefix and old[-1 - suffix] == new[-1 - suffix]:
        suffix += 1
    return prefix, suffix


def character_changes(old, new):
    """(start, end, replacement) on `old`, in order, character by character."""
    if len(old) + len(new) > CHARACTER_DIFF_LIMIT:
        head, tail = common_ends(old, new)
        return [(head, len(old) - tail, new[head : len(new) - tail])]
    spans = []
    matcher = SequenceMatcher(None, old, new, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if spans and i1 - spans[-1][1] < MIN_KEPT:
            spans[-1][1:] = [i2, spans[-1][2], j2]
        else:
            spans.append([i1, i2, j1, j2])
    return [(i1, i2, new[j1:j2]) for i1, i2, j1, j2 in spans]


def changes(old, new):
    """
    What turns `old` into `new`, as (start, end, replacement) on `old`, by
    character and in order: the lines that differ, then what differs in them.
    """
    old_lines = old.splitlines(keepends=True)
    new_lines = new.splitlines(keepends=True)
    starts = [0]
    for line in old_lines:
        starts.append(starts[-1] + len(line))
    result = []
    matcher = SequenceMatcher(None, old_lines, new_lines, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        old_part = "".join(old_lines[i1:i2])
        new_part = "".join(new_lines[j1:j2])
        for start, end, replacement in character_changes(old_part, new_part):
            result.append((starts[i1] + start, starts[i1] + end, replacement))
    return result


def own_clock(doc: Doc):
    """The clock the doc's next insertion gets: how much it has inserted so far."""
    decoder = Decoder(doc.get_state())
    for _ in range(decoder.read_var_uint()):
        client = decoder.read_var_uint()
        clock = decoder.read_var_uint()
        if client == doc.client_id:
            return clock
    return 0


def rewrite(doc: Doc, new):
    """
    Edits the doc's text into `new`. Returns where the last insertion landed,
    as a Yjs selection (relative positions, which follow the text as others
    edit it), or None if nothing was inserted.
    """
    text = text_of(doc)
    old = str(text)
    selection = None
    clock = own_clock(doc)
    with doc.transaction():
        # From the end: what comes before each change stays where it was.
        for start, end, replacement in reversed(changes(old, new)):
            byte_start = len(old[:start].encode())
            if end > start:
                del text[byte_start : byte_start + len(old[start:end].encode())]
            if replacement:
                text.insert(byte_start, replacement)
                length = utf16_length(replacement)
                selection = selection_of(doc.client_id, clock, length)
                clock += length
    return selection


def selection_of(client, clock, length):
    """Covers `length` units inserted by `client` from `clock`, as Yjs JSON."""
    return {
        "anchor": {"item": {"client": client, "clock": clock}, "assoc": 0},
        "head": {"item": {"client": client, "clock": clock + length - 1}, "assoc": -1},
    }
