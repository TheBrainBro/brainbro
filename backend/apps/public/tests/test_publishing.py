import pytest

from apps.items.models import Item
from apps.public.publishing import (
    SlugTaken,
    is_valid_slug,
    publish,
    suggested_slug,
    unpublish,
)


def note(user, title="", body="text"):
    return Item.objects.create(owner=user, kind=Item.Kind.NOTE, title=title, body=body)


def test_the_slug_comes_from_the_title(user):
    assert suggested_slug(note(user, title="Café & Trip plan!")) == "cafe-trip-plan"


def test_an_untitled_note_s_slug_comes_from_its_body(user):
    assert suggested_slug(note(user, body="# Reading list\nmore")) == "reading-list"


def test_a_note_without_words_is_just_note(user):
    assert suggested_slug(note(user, body="🙂")) == "note"


def test_a_slug_in_use_anywhere_on_the_server_gets_a_number(user, other_user):
    publish(note(other_user, title="Plan"))
    publish(note(user, title="Plan"))

    assert suggested_slug(note(user, title="Plan")) == "plan-3"


def test_long_titles_make_short_slugs(user):
    slug = suggested_slug(note(user, title="word " * 40))

    assert len(slug) <= 80
    assert not slug.endswith("-")


@pytest.mark.parametrize(
    ("slug", "valid"),
    [
        ("trip-plan", True),
        ("2026", True),
        ("Trip", False),
        ("trip plan", False),
        ("-trip", False),
        ("trip--plan", False),
        ("a" * 81, False),
    ],
)
def test_what_a_slug_can_be(slug, valid):
    assert is_valid_slug(slug) is valid


def test_publishing_again_keeps_the_address(user):
    item = publish(note(user, title="Plan"))
    unpublish(item)
    item.title = "Renamed"
    item.save()

    publish(item)

    assert item.public_slug == "plan"
    assert item.published_at is not None


def test_a_slug_another_note_has_is_refused(user, other_user):
    publish(note(other_user, title="Plan"))

    with pytest.raises(SlugTaken):
        publish(note(user), "plan")


def test_unpublished_notes_hold_their_slug(user):
    unpublish(publish(note(user, title="Plan")))

    with pytest.raises(SlugTaken):
        publish(note(user), "plan")
