from django.db import migrations, models

# The audio types libmagic names, as browsers play them (see `audio`).
SERVED_AS = {
    "audio/x-wav": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "audio/x-flac": "audio/flac",
    "audio/x-m4a": "audio/mp4",
    "audio/x-hx-aac-adts": "audio/aac",
    "audio/opus": "audio/ogg",
}


def audio_files_to_audio(apps, schema_editor):
    # Audio and voice messages sent to the bot were kept as files: they
    # become audio items, with a player. Recordings in a WebM or MP4
    # container stay files: telling them from videos means reading them.
    Item = apps.get_model("items", "Item")
    for item in Item.objects.filter(kind="file", metadata__mime__startswith="audio/"):
        mime = item.metadata["mime"]
        item.kind = "audio"
        item.metadata = {**item.metadata, "mime": SERVED_AS.get(mime, mime)}
        item.save(update_fields=["kind", "metadata"])


def audio_to_files(apps, schema_editor):
    Item = apps.get_model("items", "Item")
    Item.objects.filter(kind="audio").update(kind="file")


class Migration(migrations.Migration):
    dependencies = [
        ("items", "0014_item_origin"),
    ]

    operations = [
        migrations.AlterField(
            model_name="item",
            name="kind",
            field=models.CharField(
                choices=[
                    ("note", "Note"),
                    ("link", "Link"),
                    ("image", "Image"),
                    ("file", "File"),
                    ("audio", "Audio"),
                    ("album", "Album"),
                ],
                max_length=8,
            ),
        ),
        migrations.RunPython(audio_files_to_audio, audio_to_files),
    ]
