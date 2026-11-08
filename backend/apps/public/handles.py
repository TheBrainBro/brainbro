"""
A user's public address on the server: their published notes live at
`/@<handle>/<slug>`, so each user's slugs are their own and two users can
both have an `about`. The handle is made from the display name the first
time it is needed and can be changed in the profile; never the username,
which is half of the login.
"""

import re

from django.db import IntegrityError, transaction
from django.utils.text import slugify

from apps.accounts.models import Profile

MIN_HANDLE = 2
MAX_HANDLE = 40
HANDLE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
DEFAULT_HANDLE = "author"


def is_valid_handle(handle):
    return MIN_HANDLE <= len(handle) <= MAX_HANDLE and bool(HANDLE.fullmatch(handle))


def handle_taken(handle, user_id):
    return Profile.objects.filter(handle=handle).exclude(user_id=user_id).exists()


def suggested_handle(profile):
    """The display name as an address (`Ana Pérez` is `ana-perez`), still free."""
    base = slugify(profile.display_name)[:MAX_HANDLE].strip("-")
    if len(base) < MIN_HANDLE:
        base = DEFAULT_HANDLE
    taken = set(
        Profile.objects.filter(handle__startswith=base)
        .exclude(pk=profile.pk)
        .values_list("handle", flat=True)
    )
    handle, number = base, 1
    while handle in taken:
        number += 1
        suffix = f"-{number}"
        handle = base[: MAX_HANDLE - len(suffix)].strip("-") + suffix
    return handle


def public_handle(user_id):
    """The user's handle, given one first if they have none."""
    profile, _ = Profile.objects.get_or_create(user_id=user_id)
    while not profile.handle:
        profile.handle = suggested_handle(profile)
        try:
            # Someone else may take it in between.
            with transaction.atomic():
                profile.save(update_fields=["handle", "updated_at"])
        except IntegrityError:
            profile.handle = None
    return profile.handle
