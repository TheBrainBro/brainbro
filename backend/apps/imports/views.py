from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response

from .models import Import
from .serializers import ImportSerializer, ImportUploadSerializer
from .tasks import IMPORT_TIME_LIMIT, run_import


class ImportViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """
    Obsidian vault imports of the current user. `POST` a zip as `file` to
    start one; it's done when `status` is `ready` (with `counts`) or `failed`
    (with `error`). One runs at a time.
    """

    serializer_class = ImportSerializer

    def get_queryset(self):
        return Import.objects.filter(owner=self.request.user)

    def create(self, request):
        payload = ImportUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        upload = payload.validated_data["file"]
        with transaction.atomic():
            imports = self.get_queryset().select_for_update()
            # One that has been pending past the task's time limit is stuck.
            running = imports.filter(
                status=Import.Status.PENDING,
                created_at__gt=timezone.now() - timedelta(seconds=IMPORT_TIME_LIMIT),
            ).exists()
            if running:
                return Response(
                    {"detail": "An import is already running."},
                    status=status.HTTP_409_CONFLICT,
                )
            vault_import = Import(
                owner=request.user, filename=upload.name.rsplit("/", 1)[-1][:255]
            )
            vault_import.file.save("vault.zip", upload, save=False)
            vault_import.save()
            transaction.on_commit(lambda: run_import.delay(str(vault_import.id)))
        return Response(
            self.get_serializer(vault_import).data, status=status.HTTP_202_ACCEPTED
        )
