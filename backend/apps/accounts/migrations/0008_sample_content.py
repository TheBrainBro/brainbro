from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0007_profile_language"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="sample_content_created_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
