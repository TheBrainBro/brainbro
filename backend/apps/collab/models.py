from django.db import models

from apps.items.models import Item


class NoteDocument(models.Model):
    """
    The shared document behind a note open in several places at once (see
    `documents`): every session's edits, merged. `Item.body` stays the note's
    text for everything else; this is what lets edits made apart, even
    offline, merge with it.
    """

    note = models.OneToOneField(
        Item, primary_key=True, on_delete=models.CASCADE, related_name="document"
    )
    # The Yjs document, encoded as one update.
    state = models.BinaryField()
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return str(self.note_id)
