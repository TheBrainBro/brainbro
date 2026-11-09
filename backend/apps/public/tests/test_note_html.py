import json
from pathlib import Path

import pytest

from apps.public.note_html import render_note, sanitize, without_title
from apps.public.site_pages import MESSAGES

# The app's renderer reads the same file (`frontend/src/lib/markdown.parity.test.ts`).
DATA = json.loads((Path(__file__).parent / "markdown_cases.json").read_text())


def render(body, *, messages=None):
    return render_note(
        body,
        images=DATA["images"],
        links=DATA["links"],
        notes=DATA["notes"],
        messages=messages or MESSAGES["en"],
    )


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda case: case["name"])
def test_a_note_reads_as_in_the_app(case):
    assert render(case["body"]) == case["html"]


def test_the_page_s_language_reaches_the_note():
    html = render("- [x] listo", messages=MESSAGES["es"])

    assert 'aria-label="Hecha"' in html


@pytest.mark.parametrize(
    "dirty, clean",
    [
        ("<script>alert(1)</script>ok", "ok"),
        ('<a href="javascript:alert(1)" onclick="x()">y</a>', "<a>y</a>"),
        ('<img src="/a.png" onerror="x()">', '<img src="/a.png">'),
    ],
)
def test_what_a_rule_lets_through_is_cleaned(dirty, clean):
    assert sanitize(dirty) == clean


def test_only_known_players_keep_their_address():
    assert "evil" not in sanitize('<iframe src="https://evil.example/x"></iframe>')
    known = '<iframe src="https://player.vimeo.com/video/1"></iframe>'
    assert sanitize(known) == known


@pytest.mark.parametrize(
    "body, rest",
    [
        ("# Trip\n\nText", "Text"),
        ("Trip\nText", "Text"),
        ("# Trip #\nText", "Text"),
        ("Another\nText", "Another\nText"),
    ],
)
def test_the_title_is_not_shown_twice(body, rest):
    assert without_title(body, "Trip") == rest
