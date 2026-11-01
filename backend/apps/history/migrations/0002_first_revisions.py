from django.db import migrations

BATCH = 500


def first_revisions(apps, schema_editor):
    """
    What every note and board holds now, as its first revision, so the first
    edit after this can be compared with it and undone.
    """
    Item = apps.get_model("items", "Item")
    Board = apps.get_model("boards", "Board")
    Revision = apps.get_model("history", "Revision")

    def note_revision(note):
        edited = note.edited_at is not None
        return Revision(
            owner_id=note.owner_id,
            item_id=note.id,
            title=note.title,
            body=note.body,
            by=note.edited_by if edited else note.created_by,
            via=note.edited_via if edited else note.created_via,
            created_at=note.edited_at or note.updated_at,
        )

    def board_revision(board):
        return Revision(
            owner_id=board.owner_id,
            board_id=board.id,
            title=board.title,
            layout=board.layout,
            created_at=board.updated_at,
        )

    notes = Item.objects.filter(kind="note").only(
        "id",
        "owner_id",
        "title",
        "body",
        "created_by",
        "created_via",
        "edited_by",
        "edited_via",
        "edited_at",
        "updated_at",
    )
    save(Revision, map(note_revision, notes.iterator(chunk_size=BATCH)))
    save(Revision, map(board_revision, Board.objects.iterator(chunk_size=BATCH)))


def save(Revision, revisions):
    batch = []
    for revision in revisions:
        batch.append(revision)
        if len(batch) == BATCH:
            save_batch(Revision, batch)
            batch = []
    save_batch(Revision, batch)


def save_batch(Revision, batch):
    # Creating stamps them now: their times are set right after.
    at = [revision.created_at for revision in batch]
    created = Revision.objects.bulk_create(batch)
    for revision, when in zip(created, at, strict=True):
        revision.created_at = revision.updated_at = when
    Revision.objects.bulk_update(created, ["created_at", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [
        ("history", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(first_revisions, migrations.RunPython.noop),
    ]
