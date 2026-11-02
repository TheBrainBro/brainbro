"""
Publishing a note: it gets a public address, `/p/<slug>`, that anyone can
read while it is published. The slug is made from its title and can be
changed; slugs are unique across the whole server, every user's notes
included, since they share the address space.
"""

import re

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.items.models import Item
from apps.items.titles import note_title

MAX_SLUG = 80
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


class SlugTaken(Exception):
    pass


def is_valid_slug(slug):
    return len(slug) <= MAX_SLUG and bool(SLUG.fullmatch(slug))


def suggested_slug(note):
    """Its title as an address (`Trip plan` is `trip-plan`), free on the server."""
    title = note.title or note_title(note.body)
    base = slugify(title)[:MAX_SLUG].strip("-") or "note"
    taken = set(
        Item.objects.filter(public_slug__startswith=base)
        .exclude(pk=note.pk)
        .values_list("public_slug", flat=True)
    )
    slug, number = base, 1
    while slug in taken:
        number += 1
        suffix = f"-{number}"
        slug = base[: MAX_SLUG - len(suffix)].strip("-") + suffix
    return slug


def publish(note, slug=None):
    """
    Publishes `note` at `slug`, or at the one it had, or at one made from its
    title. Raises SlugTaken if another note has that slug.
    """
    if slug is None:
        slug = note.public_slug or suggested_slug(note)
    elif Item.objects.filter(public_slug=slug).exclude(pk=note.pk).exists():
        raise SlugTaken
    note.public_slug = slug
    note.published_at = note.published_at or timezone.now()
    try:
        # Another note may take the slug in between.
        with transaction.atomic():
            note.save(update_fields=["public_slug", "published_at", "updated_at"])
    except IntegrityError:
        raise SlugTaken from None
    return note


PAGE_FIELDS = {
    "title": "public_title",
    "description": "public_description",
    "image": "public_image",
}


def save_page(note, changes):
    """
    Saves the page settings in `changes` (`slug`, `title`, `description`,
    `image`); empty ones go back to their default. Raises SlugTaken if
    another note has the slug.
    """
    fields = []
    if "slug" in changes and changes["slug"] != note.public_slug:
        if (
            Item.objects.filter(public_slug=changes["slug"])
            .exclude(pk=note.pk)
            .exists()
        ):
            raise SlugTaken
        note.public_slug = changes["slug"]
        fields.append("public_slug")
    for name, field in PAGE_FIELDS.items():
        if name in changes:
            setattr(note, field, changes[name])
            fields.append(field)
    try:
        with transaction.atomic():
            note.save(update_fields=[*fields, "updated_at"])
    except IntegrityError:
        raise SlugTaken from None
    return note


def unpublish(note):
    """Takes the note down. It keeps its slug for when it is published again."""
    note.published_at = None
    note.save(update_fields=["published_at", "updated_at"])
    return note
