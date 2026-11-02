from django.db import transaction

from .note_images import sync_note_images
from .note_links import sync_note_links
from .tasks import fetch_note_images, fetch_note_links


def sync_images(note):
    """Images and link previews the note now shows, fetched in the background."""
    if sync_note_images(note):
        transaction.on_commit(lambda: fetch_note_images.delay(str(note.id)))
    if sync_note_links(note):
        transaction.on_commit(lambda: fetch_note_links.delay(str(note.id)))
