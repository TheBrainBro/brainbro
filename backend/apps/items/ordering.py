"""
Hand-sorted lists: the inbox, each collection, and the collections inside
each collection (or at the top); boards use `place` too. Each place in them is a
rank, highest first (see `models.rank_now`); moving an item gives it a rank
between its new neighbours, so nothing else has to change. When two ranks get
too close to split, the list is spaced out again first.
"""

from django.db import transaction
from django.utils import timezone

from .models import Collection, CollectionItem, Item, rank_now

# Closer than this, a midpoint loses precision: space the list out first.
MIN_GAP = 1e-6


def place(rows, moving, after, set_rank):
    """
    `rows`: (key, rank) of the list, highest first, without `moving`. Puts
    `moving` right after `after` (or on top when None) through `set_rank`.
    Returns False if `after` isn't in the list.
    """
    keys = [key for key, _ in rows]
    if after is None:
        # Now, like something new: what comes in later still lands above it.
        top = rows[0][1] if rows else 0
        set_rank(moving, max(rank_now(), top + MIN_GAP * 1000))
        return True
    if after not in keys:
        return False
    at = keys.index(after)
    above = rows[at][1]
    if at + 1 == len(rows):
        set_rank(moving, above - 1)
        return True
    below = rows[at + 1][1]
    if above - below < MIN_GAP:
        # Spaced out by one, keeping the order and the top where it was.
        top = rows[0][1]
        rows = [(key, top - index) for index, (key, _) in enumerate(rows)]
        for key, rank in rows:
            set_rank(key, rank)
        above, below = rows[at][1], rows[at + 1][1]
    set_rank(moving, (above + below) / 2)
    return True


@transaction.atomic
def move_in_inbox(item, after):
    """Puts `item` (in the inbox) right after `after` (an item id) or on top."""
    rows = list(
        Item.objects.select_for_update()
        .filter(owner=item.owner, status=Item.Status.INBOX, album__isnull=True)
        .exclude(id=item.id)
        .order_by("-inbox_rank", "-created_at")
        .values_list("id", "inbox_rank")
    )

    def set_rank(item_id, rank):
        Item.objects.filter(id=item_id).update(inbox_rank=rank)

    return place(rows, item.id, after, set_rank)


@transaction.atomic
def move_in_collection(item, collection, after):
    """Puts `item` right after `after` (an item id) or on top, in `collection`."""
    links = CollectionItem.objects.select_for_update().filter(
        collection=collection, item__album__isnull=True
    )
    rows = list(
        links.exclude(item_id=item.id)
        .order_by("-rank", "-item__created_at")
        .values_list("item_id", "rank")
    )

    def set_rank(item_id, rank):
        CollectionItem.objects.filter(collection=collection, item_id=item_id).update(
            rank=rank
        )

    return place(rows, item.id, after, set_rank)


@transaction.atomic
def move_collection(collection, parent, after):
    """
    Puts `collection` inside `parent` (None: at the top), right after `after`
    (a collection id there) or on top. Checking that `parent` isn't inside
    `collection` is up to the caller.
    """
    rows = list(
        Collection.objects.select_for_update()
        .filter(owner=collection.owner, parent=parent)
        .exclude(id=collection.id)
        .order_by("-rank", "name")
        .values_list("id", "rank")
    )

    def set_rank(collection_id, rank):
        Collection.objects.filter(id=collection_id).update(rank=rank)

    if not place(rows, collection.id, after, set_rank):
        return False
    if collection.parent_id != (parent.id if parent else None):
        Collection.objects.filter(id=collection.id).update(
            parent=parent, updated_at=timezone.now()
        )
    return True
