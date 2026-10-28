from django.db import models

from apps.core.models import OwnedModel
from apps.items.models import Item

from .layout import empty_layout


class Board(OwnedModel):
    """
    An infinite canvas: items laid out in space (see `layout`).

    The layout JSON is the source of truth for what is on the board and where.
    `items` mirrors the item nodes, synced on every save, so the database can
    answer which boards an item is on and drop it when the item is deleted.
    """

    title = models.CharField(max_length=200)
    layout = models.JSONField(default=empty_layout)
    # Bumped on every layout save. Saves send it back (If-Match), so one tab
    # can't silently overwrite another's layout.
    revision = models.PositiveIntegerField(default=1)
    items = models.ManyToManyField(Item, related_name="boards", blank=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner", "-updated_at"]),
        ]

    def __str__(self):
        return self.title
