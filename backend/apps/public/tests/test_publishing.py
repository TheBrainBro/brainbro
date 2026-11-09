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


def test_a_slug_the_owner_uses_gets_a_number(user):
    publish(note(user, title="Plan"))
    publish(note(user, title="Plan"))

    assert suggested_slug(note(user, title="Plan")) == "plan-3"


def test_other_users_slugs_are_theirs(user, other_user):
    publish(note(other_user, title="Plan"))

    assert publish(note(user, title="Plan")).public_slug == "plan"


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


def test_a_slug_another_of_their_notes_has_is_refused(user):
    publish(note(user, title="Plan"))

    with pytest.raises(SlugTaken):
        publish(note(user), "plan")


def test_publishing_gives_the_owner_a_handle(user):
    publish(note(user, title="Plan"))

    assert user.profile.handle == "author"


def test_unpublished_notes_hold_their_slug(user):
    unpublish(publish(note(user, title="Plan")))

    with pytest.raises(SlugTaken):
        publish(note(user), "plan")


def test_a_blog_s_own_pages_are_never_slugs(user):
    assert is_valid_slug("rss") is False
    assert suggested_slug(note(user, title="RSS")) == "rss-2"


def test_publishing_unlisted_and_back(user):
    item = publish(note(user, title="Trip"), listed=False)
    assert item.public_listed is False

    assert publish(item, listed=True).public_listed is True


def test_publishing_again_keeps_it_unlisted(user):
    item = publish(note(user, title="Trip"), listed=False)
    unpublish(item)

    assert publish(item).public_listed is False
