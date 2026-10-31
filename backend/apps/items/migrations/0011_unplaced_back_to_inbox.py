from django.db import migrations
from django.utils import timezone


def unplaced_back_to_inbox(apps, schema_editor):
    # Taken off their last board before boards sent them back, these items
    # were organized but nowhere: they go to the top of the inbox.
    Item = apps.get_model("items", "Item")
    now = timezone.now()
    Item.objects.filter(
        status="organized",
        album__isnull=True,
        boards__isnull=True,
        collections__isnull=True,
    ).update(status="inbox", inbox_rank=now.timestamp(), updated_at=now)


class Migration(migrations.Migration):
    dependencies = [
        ("items", "0010_collection_parent"),
        ("boards", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(unplaced_back_to_inbox, migrations.RunPython.noop),
    ]
