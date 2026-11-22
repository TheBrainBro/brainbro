from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.response import Response

from apps.accounts.quota import QuotaExceeded, check_room

from .brainbro import source_of
from .models import Import
from .serializers import ImportSerializer, ImportUploadSerializer
from .tasks import IMPORT_TIME_LIMIT, run_import


class ImportViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """
    Imports of the current user: an Obsidian vault or a BrainBro export,
    told apart by its files (`source`). `POST` a zip as `file` to start one;
    it's done when `status` is `ready` (with `counts`) or `failed` (with
    `error`). One runs at a time.
    """

    serializer_class = ImportSerializer

    def get_queryset(self):
        return Import.objects.filter(owner=self.request.user)

    def create(self, request):
        payload = ImportUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        upload = payload.validated_data["file"]
        # The zip itself doesn't count; what it holds is checked as it is
        # imported. With no room left at all, it isn't worth starting.
        try:
            check_room(request.user, 1)
        except QuotaExceeded as exc:
            raise serializers.ValidationError({"file": str(exc)}) from None
        with transaction.atomic():
            # Concurrent first imports have no job row to lock yet.
            get_user_model().objects.select_for_update(no_key=True).only("pk").get(
                pk=request.user.pk
            )
            # One that has been pending past the task's time limit is stuck.
            running = self.get_queryset().filter(
                status=Import.Status.PENDING,
                created_at__gt=timezone.now() - timedelta(seconds=IMPORT_TIME_LIMIT),
            )
            if running.exists():
                return Response(
                    {"detail": "An import is already running."},
                    status=status.HTTP_409_CONFLICT,
                )
            vault_import = Import(
                owner=request.user,
                filename=upload.name.rsplit("/", 1)[-1][:255],
                source=source_of(upload),
            )
            vault_import.file.save("vault.zip", upload, save=False)
            vault_import.save()
            transaction.on_commit(lambda: run_import.delay(str(vault_import.id)))
        return Response(
            self.get_serializer(vault_import).data, status=status.HTTP_202_ACCEPTED
        )
