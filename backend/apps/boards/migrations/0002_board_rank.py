from django.db import migrations, models
from django.utils import timezone

import apps.items.models


def ranks_from_edits(apps, schema_editor):
    # Until now boards were last edited first: keep that order.
    Board = apps.get_model("boards", "Board")
    boards = list(Board.objects.order_by("-updated_at").only("id", "updated_at"))
    top = timezone.now().timestamp()
    for index, board in enumerate(boards):
        board.rank = top - index
    Board.objects.bulk_update(boards, ["rank"], batch_size=1000)


class Migration(migrations.Migration):
    dependencies = [
        ("boards", "0001_initial"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="board",
            options={"ordering": ["-rank", "-updated_at"]},
        ),
        migrations.RemoveIndex(
            model_name="board",
            name="boards_boar_owner_i_4420f5_idx",
        ),
        migrations.AddField(
            model_name="board",
            name="rank",
            field=models.FloatField(default=apps.items.models.rank_now),
        ),
        migrations.RunPython(ranks_from_edits, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="board",
            index=models.Index(
                fields=["owner", "-rank"], name="boards_boar_owner_i_ec10a5_idx"
            ),
        ),
    ]
