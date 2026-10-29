"""
Albums: several images kept as one item. The images stay items of their own
(files, thumbnails and their URLs work as usual), pointing at the album in
order, and only show up through it.
"""

from django.db import transaction
from django.utils import timezone

from .models import Item

MAX_IMAGES = 100


class AlbumError(ValueError):
    pass


def _check(images, album=None):
    if len(images) > MAX_IMAGES:
        raise AlbumError(f"An album holds at most {MAX_IMAGES} images.")
    for image in images:
        if image.kind != Item.Kind.IMAGE:
            raise AlbumError("Only images go in an album.")
        if image.album_id and image.album_id != getattr(album, "id", None):
            raise AlbumError("An image is already in another album.")


def _place(album, images):
    """Makes `images` the album's contents, in order; the rest go back on their own."""
    now = timezone.now()
    kept = {image.id for image in images}
    album.album_items.exclude(id__in=kept).update(
        album=None, album_position=0, status=album.status, updated_at=now
    )
    for position, image in enumerate(images):
        image.album = album
        image.album_position = position
        image.updated_at = now
    Item.objects.bulk_update(images, ["album", "album_position", "updated_at"])


@transaction.atomic
def make_album(owner, images, title=""):
    """A new album in the inbox holding `images`, in order."""
    if len(images) < 2:
        raise AlbumError("An album needs at least two images.")
    _check(images)
    album = Item.objects.create(owner=owner, kind=Item.Kind.ALBUM, title=title)
    _place(album, images)
    return album


@transaction.atomic
def set_album_images(album, images):
    """Reorders, adds and removes: the album then holds exactly `images`."""
    if not images:
        raise AlbumError("An album needs at least one image; ungroup it instead.")
    _check(images, album)
    _place(album, images)
    album.save(update_fields=["updated_at"])
    return album


@transaction.atomic
def ungroup(album):
    """Takes the album away; its images stay, on their own, where the album was."""
    images = list(album.album_items.all())
    album.album_items.update(
        album=None, album_position=0, status=album.status, updated_at=timezone.now()
    )
    # Detached first, so deleting the album takes nothing with it.
    album.delete()
    return images
