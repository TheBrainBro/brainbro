from types import SimpleNamespace

from apps.items.models import Item
from apps.items.titles import linkable_titles, note_title, wikilink_target


def test_the_first_h1_names_the_note():
    assert note_title("Some intro\n\n# **Trip** plan\nmore\n# Other") == "Trip plan"


def test_headings_inside_code_don_t_count():
    body = "Setup\n```sh\n# install it\n```\n# Real title"
    assert note_title(body) == "Real title"


def test_without_an_h1_it_is_the_first_line_as_plain_words():
    assert note_title("\n\n## *Trip* plan\nmore") == "Trip plan"
    assert note_title("> - [x] Read [the docs](https://example.com) `now`") == (
        "Read the docs now"
    )
    assert note_title("1. ==First== step") == "First step"


def test_falls_back_when_there_are_no_words():
    assert note_title("") == "Note"
    assert note_title("#  ", fallback="") == ""


def test_stays_short():
    assert len(note_title("a" * 200)) == 80


def test_saved_titles_are_tried_before_the_ones_from_the_body():
    shown = SimpleNamespace(id=1, title="", body="# Plan\nmore")
    saved = SimpleNamespace(id=2, title="Plan", body="")
    empty = SimpleNamespace(id=3, title="", body="  ")

    assert linkable_titles([shown, saved, empty]) == [(2, "Plan"), (1, "Plan")]


def test_a_link_to_a_vault_path_means_its_title():
    assert wikilink_target(" Folder/Plan.md ") == "Plan"
    assert wikilink_target("Plan") == "Plan"


def test_note_titles_lists_the_user_s_notes_in_lookup_order(api, user, other_user):
    shown = Item.objects.create(owner=user, kind="note", body="# Trip\nmore")
    saved = Item.objects.create(owner=user, kind="note", title="Ideas", body="x")
    Item.objects.create(owner=user, kind="link", url="https://example.com")
    Item.objects.create(owner=other_user, kind="note", title="Theirs")

    response = api.get("/api/items/note-titles/")

    assert response.status_code == 200
    assert response.json() == [
        {"id": str(saved.id), "title": "Ideas"},
        {"id": str(shown.id), "title": "Trip"},
    ]
