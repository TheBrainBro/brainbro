import zipfile

from django.conf import settings
from rest_framework import serializers

from .models import Import


class ImportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Import
        fields = [
            "id",
            "status",
            "filename",
            "counts",
            "error",
            "created_at",
            "finished_at",
        ]
        read_only_fields = fields


class ImportUploadSerializer(serializers.Serializer):
    file = serializers.FileField(allow_empty_file=False)

    def validate_file(self, file):
        limit = settings.IMPORT_MAX_SIZE
        if file.size > limit:
            raise serializers.ValidationError(
                f"The zip is too large (max {limit // (1024 * 1024)} MB)."
            )
        if not zipfile.is_zipfile(file):
            raise serializers.ValidationError("Upload the vault as a .zip file.")
        file.seek(0)
        return file
