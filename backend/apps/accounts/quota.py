"""
How much each user stores on disk, and the quota that caps it.

Every file kept for a user counts: uploads and their thumbnails, note images,
link previews, avatars, collection and blog images. Exports and vault zips
waiting to be imported don't: they are temporary, and an export must always
be possible, so nobody is kept from taking their data out.

New files a user adds are refused once they don't fit (`check_room`). What
the app makes on its own afterwards (thumbnails, previews, copies of remote
images) is never refused, but counts.

The quota is the profile's own `storage_quota`, or STORAGE_QUOTA for
everyone else, both in MB; empty means no quota.
"""

from django.conf import settings
from django.core.files.storage import default_storage

from apps.items.models import Collection, Item, NoteImage, NoteLink
from apps.public.models import Site

from .models import Profile

# (model, the field pointing at its owner, its file fields).
FILES = [
    (Item, "owner", ["file", "preview_image"]),
    (NoteImage, "owner", ["image", "original"]),
    (NoteLink, "owner", ["image"]),
    (Collection, "owner", ["image"]),
    (Site, "owner", ["avatar", "social_image"]),
    (Profile, "user", ["avatar"]),
]

MB = 1024 * 1024
GB = 1024 * MB


class QuotaExceeded(Exception):
    def __init__(self, used, quota):
        self.used = used
        self.quota = quota
        left = format_size(max(quota - used, 0))
        super().__init__(
            f"Not enough storage left: {left} free of {format_size(quota)}."
        )


def format_size(size):
    if size >= GB:
        return f"{size / GB:.1f} GB".replace(".0 ", " ")
    return f"{round(size / MB)} MB"


def storage_quota(user):
    """The most `user` may store, in bytes, or None for no limit."""
    own = (
        Profile.objects.filter(user=user)
        .values_list("storage_quota", flat=True)
        .first()
    )
    quota = own if own is not None else settings.STORAGE_QUOTA
    return None if quota is None else quota * MB


def storage_used(user):
    """What `user`'s files take on disk, in bytes."""
    used = 0
    for model, owner, fields in FILES:
        for names in model.objects.filter(**{owner: user}).values_list(*fields):
            used += sum(_size(name) for name in names if name)
    return used


def _size(name):
    try:
        return default_storage.size(name)
    except OSError:
        # Already gone: it takes no room.
        return 0


def check_room(user, size, freed=0):
    """
    Raises QuotaExceeded unless `size` more bytes fit in `user`'s quota,
    after freeing `freed` (the file a new one replaces).
    """
    quota = storage_quota(user)
    if quota is None:
        return
    used = storage_used(user)
    if used - freed + size > quota:
        raise QuotaExceeded(used, quota)


def file_size(field):
    """The size of the file in `field`, or 0 if there is none."""
    return _size(field.name) if field else 0


def storage_data(user):
    """What the app shows: bytes used, and the quota (None for no limit)."""
    return {"used": storage_used(user), "quota": storage_quota(user)}
