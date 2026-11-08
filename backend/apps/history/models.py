from django.db import models

from apps.boards.models import Board
from apps.core.models import OwnedModel
from apps.items.models import Item
from apps.items.origin import Source


class Revision(OwnedModel):
    """
    A note's title and body, or a board's title and layout, as saved, with
    who saved it and through what (see `apps.items.origin`). The latest one is
    always what the note or board holds now; `recording` keeps it so.

    Saves by the same author in a row become one revision for a while
    (`recording.WINDOW`): it starts at `created_at` and ends at `updated_at`.
    Once another follows it, a revision never changes, and restoring one
    makes a new one (`restored_from`), so nothing in the history is lost.
    """

    item = models.ForeignKey(
        Item, null=True, blank=True, on_delete=models.CASCADE, related_name="revisions"
    )
    board = models.ForeignKey(
        Board, null=True, blank=True, on_delete=models.CASCADE, related_name="revisions"
    )
    title = models.CharField(max_length=500, blank=True)
    # A note's Markdown; empty for boards.
    body = models.TextField(blank=True)
    # A board's layout, in the schema it had then; null for notes.
    layout = models.JSONField(null=True, blank=True)
    # The app's name; empty for the user.
    by = models.CharField(max_length=200, blank=True)
    via = models.CharField(
        max_length=16, choices=Source, default=Source.UNKNOWN, blank=True
    )
    # Which logo goes with `by`; see `apps.accounts.logos`.
    logo = models.CharField(max_length=32, blank=True)
    restored_from = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["item", "-created_at"]),
            models.Index(fields=["board", "-created_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(item__isnull=False, board__isnull=True)
                | models.Q(item__isnull=True, board__isnull=False),
                name="revision_of_a_note_or_a_board",
            ),
        ]

    def __str__(self):
        return f"{self.title or self.item_id or self.board_id} at {self.created_at}"
