"""
File names for the export: the item's title, cleaned so it works on Windows,
macOS and Linux, unique within its folder.
"""

import re
import unicodedata

MAX_NAME = 100

# Forbidden on Windows (and `/` everywhere), plus control characters.
FORBIDDEN = re.compile(r'[/\\:*?"<>|\x00-\x1f\x7f]')
SPACES = re.compile(r"\s+")
RESERVED = {"con", "prn", "aux", "nul"} | {
    f"{name}{i}" for name in ("com", "lpt") for i in range(1, 10)
}


def clean(text, fallback="Untitled"):
    """A name made of `text`, safe as a file or folder name."""
    name = unicodedata.normalize("NFC", text or "")
    name = SPACES.sub(" ", FORBIDDEN.sub(" ", name)).strip()
    name = name[:MAX_NAME].rstrip(" .").lstrip(" .")
    if not name:
        return fallback
    if name.split(".", 1)[0].lower() in RESERVED:
        name = f"{name}_"
    return name


class Folder:
    """
    Hands out unique names within one folder. Case-insensitive, because the
    zip may be opened on macOS or Windows: `Ideas` and `ideas` would clash.
    """

    def __init__(self):
        self.taken = set()

    def name(self, stem, extension=""):
        suffix = f".{extension}" if extension else ""
        candidate, n = stem, 1
        while f"{candidate}{suffix}".lower() in self.taken:
            n += 1
            candidate = f"{stem} {n}"
        self.taken.add(f"{candidate}{suffix}".lower())
        return f"{candidate}{suffix}"
