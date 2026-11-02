from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boards", "0002_board_rank")]

    operations = [
        migrations.AddField(
            model_name="board",
            name="is_sample",
            field=models.BooleanField(db_default=False, default=False),
        ),
    ]
