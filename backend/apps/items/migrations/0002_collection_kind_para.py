from django.db import migrations, models


def personal_to_resource(apps, schema_editor):
    Collection = apps.get_model("items", "Collection")
    Collection.objects.filter(kind="personal").update(kind="resource")


def resource_to_personal(apps, schema_editor):
    Collection = apps.get_model("items", "Collection")
    Collection.objects.filter(kind="resource").update(kind="personal")


class Migration(migrations.Migration):
    """Collection kinds follow PARA: project, area, resource."""

    dependencies = [
        ("items", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(personal_to_resource, resource_to_personal),
        migrations.AlterField(
            model_name="collection",
            name="kind",
            field=models.CharField(
                choices=[
                    ("project", "Project"),
                    ("area", "Area"),
                    ("resource", "Resource"),
                ],
                default="resource",
                max_length=16,
            ),
        ),
    ]
