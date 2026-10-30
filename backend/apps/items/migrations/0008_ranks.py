import django.db.models.deletion
from django.db import migrations, models

import apps.items.models


def ranks_from_creation(apps, schema_editor):
    # Until now lists were newest first: keep that order.
    Item = apps.get_model("items", "Item")
    CollectionItem = apps.get_model("items", "CollectionItem")
    items = list(Item.objects.only("id", "created_at"))
    for item in items:
        item.inbox_rank = item.created_at.timestamp()
    Item.objects.bulk_update(items, ["inbox_rank"], batch_size=1000)
    created = {item.id: item.inbox_rank for item in items}
    links = list(CollectionItem.objects.only("id", "item_id"))
    for link in links:
        link.rank = created[link.item_id]
    CollectionItem.objects.bulk_update(links, ["rank"], batch_size=1000)


class Migration(migrations.Migration):
    dependencies = [
        ("items", "0007_collection_image"),
    ]

    operations = [
        # The many-to-many table stays as it is; Django now knows it as a
        # model of its own, to give it a rank.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name="CollectionItem",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True,
                                primary_key=True,
                                serialize=False,
                                verbose_name="ID",
                            ),
                        ),
                        (
                            "collection",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.CASCADE,
                                to="items.collection",
                            ),
                        ),
                        (
                            "item",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.CASCADE,
                                to="items.item",
                            ),
                        ),
                    ],
                    options={
                        "db_table": "items_item_collections",
                        "unique_together": {("item", "collection")},
                    },
                ),
                migrations.AlterField(
                    model_name="item",
                    name="collections",
                    field=models.ManyToManyField(
                        blank=True,
                        related_name="items",
                        through="items.CollectionItem",
                        to="items.collection",
                    ),
                ),
            ],
            database_operations=[],
        ),
        migrations.AddField(
            model_name="collectionitem",
            name="rank",
            field=models.FloatField(default=apps.items.models.rank_now),
        ),
        migrations.AddField(
            model_name="item",
            name="inbox_rank",
            field=models.FloatField(default=apps.items.models.rank_now),
        ),
        migrations.RunPython(ranks_from_creation, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="collectionitem",
            index=models.Index(
                fields=["collection", "-rank"], name="items_item__collect_3773ae_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="item",
            index=models.Index(
                fields=["owner", "status", "-inbox_rank"],
                name="items_item_owner_i_0fb7f6_idx",
            ),
        ),
    ]
