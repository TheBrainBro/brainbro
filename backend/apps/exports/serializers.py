from django.urls import reverse
from rest_framework import serializers

from .models import Export


class ExportSerializer(serializers.ModelSerializer):
    filename = serializers.CharField(read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = Export
        fields = [
            "id",
            "status",
            "size",
            "filename",
            "download_url",
            "created_at",
            "finished_at",
        ]
        read_only_fields = fields

    def get_download_url(self, export):
        if export.status != Export.Status.READY:
            return None
        return reverse("export-download", args=[export.id])
