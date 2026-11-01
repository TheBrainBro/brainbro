import pytest
from pycrdt import Doc

from apps.collab.text import changes, own_clock, rewrite, text_of

CASES = [
    ("", ""),
    ("", "new"),
    ("gone", ""),
    ("same", "same"),
    ("a\nb\nc\n", "a\nB\nc\n"),
    ("one two three", "one 2 three"),
    ("héllo 😀 world\nline\nend", "X😀 héllo 😀 there world\nline two\nend\n🎉"),
    ("The quick brown fox", "A slow red dog jumps"),
    ("# Title\n\n- [ ] task\n", "# Title\n\n- [x] task\n- [ ] another\n"),
]


def applied(old, edits):
    for start, end, replacement in reversed(edits):
        old = old[:start] + replacement + old[end:]
    return old


@pytest.mark.parametrize(("old", "new"), CASES)
def test_changes_turn_the_old_text_into_the_new(old, new):
    assert applied(old, changes(old, new)) == new


def test_changes_touch_only_what_differs():
    assert changes("a\nb\nc\n", "a\nB\nc\n") == [(2, 3, "B")]
    assert changes("one two three", "one 2 three") == [(4, 7, "2")]
    assert changes("same", "same") == []


def test_unrelated_text_is_replaced_whole_not_in_scraps():
    assert changes("The quick brown fox", "A slow red dog jumps") == [
        (0, 19, "A slow red dog jumps")
    ]


@pytest.mark.parametrize(("old", "new"), CASES)
def test_rewrite_edits_the_document_text(old, new):
    doc = Doc()
    rewrite(doc, old)
    rewrite(doc, new)
    assert str(text_of(doc)) == new


def test_rewrites_merge_with_concurrent_edits():
    base = Doc()
    rewrite(base, "first line\nsecond line\n")
    mine, theirs = Doc(), Doc()
    mine.apply_update(base.get_update())
    theirs.apply_update(base.get_update())
    rewrite(mine, "first line, mine\nsecond line\n")
    rewrite(theirs, "first line\nsecond line, theirs\n")
    mine.apply_update(theirs.get_update())
    assert str(text_of(mine)) == "first line, mine\nsecond line, theirs\n"


def test_rewrite_selects_what_it_inserted_in_utf16_clocks():
    doc = Doc()
    rewrite(doc, "😀 hi")
    # The emoji is two UTF-16 units.
    assert own_clock(doc) == 5
    selection = rewrite(doc, "😀 hi there")
    assert selection == {
        "anchor": {"item": {"client": doc.client_id, "clock": 5}, "assoc": 0},
        "head": {"item": {"client": doc.client_id, "clock": 10}, "assoc": -1},
    }


def test_a_rewrite_that_only_deletes_selects_nothing():
    doc = Doc()
    rewrite(doc, "keep this")
    assert rewrite(doc, "keep") is None
