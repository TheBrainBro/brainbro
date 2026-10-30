"""
Hand-sorted lists: the inbox, and each collection. Each place in them is a
rank, highest first (see `models.rank_now`); moving an item gives it a rank
between its new neighbours, so nothing else has to change. When two ranks get
too close to split, the list is spaced out again first.
"""

from django.db import transaction

from .models import CollectionItem, Item, rank_now

# Closer than this, a midpoint loses precision: space the list out first.
MIN_GAP = 1e-6


def _place(rows, moving, after, set_rank):
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

    return _place(rows, item.id, after, set_rank)


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

    return _place(rows, item.id, after, set_rank)
