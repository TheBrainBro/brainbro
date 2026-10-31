from django.db import migrations, models
from django.utils import timezone

import apps.items.models


def ranks_from_names(apps, schema_editor):
    # Until now collections were sorted by name: keep that order.
    Collection = apps.get_model("items", "Collection")
    collections = list(Collection.objects.order_by("name").only("id", "name"))
    top = timezone.now().timestamp()
    for index, collection in enumerate(collections):
        collection.rank = top - index
    Collection.objects.bulk_update(collections, ["rank"], batch_size=1000)


class Migration(migrations.Migration):
    dependencies = [
        ("items", "0011_unplaced_back_to_inbox"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="collection",
            options={"ordering": ["-rank", "name"]},
        ),
        migrations.AddField(
            model_name="collection",
            name="rank",
            field=models.FloatField(default=apps.items.models.rank_now),
        ),
        migrations.RunPython(ranks_from_names, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="collection",
            index=models.Index(
                fields=["owner", "-rank"], name="items_colle_owner_i_f5399f_idx"
            ),
        ),
    ]
