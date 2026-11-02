from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("items", "0017_item_page_settings")]

    operations = [
        migrations.AddField(
            model_name="item",
            name="is_sample",
            field=models.BooleanField(db_default=False, default=False),
        ),
        migrations.AddField(
            model_name="collection",
            name="is_sample",
            field=models.BooleanField(db_default=False, default=False),
        ),
    ]
