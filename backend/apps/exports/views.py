from datetime import timedelta

from django.db import transaction
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Export
from .serializers import ExportSerializer
from .tasks import BUILD_TIME_LIMIT, build_export


class ExportViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """
    Full exports of the current user. `POST` starts one (or returns the one
    already being built); the zip is ready when `status` is `ready`.
    """

    serializer_class = ExportSerializer

    def get_queryset(self):
        return Export.objects.filter(owner=self.request.user)

    def create(self, request):
        with transaction.atomic():
            exports = self.get_queryset().select_for_update()
            # One that has been pending past the task's time limit is stuck.
            pending = exports.filter(
                status=Export.Status.PENDING,
                created_at__gt=timezone.now() - timedelta(seconds=BUILD_TIME_LIMIT),
            ).first()
            if pending:
                return Response(self.get_serializer(pending).data)
            # Only the latest export is kept.
            for old in exports:
                old.delete()
            export = Export.objects.create(owner=request.user)
            transaction.on_commit(lambda: build_export.delay(str(export.id)))
        return Response(
            self.get_serializer(export).data, status=status.HTTP_202_ACCEPTED
        )

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        export = self.get_object()
        if export.status != Export.Status.READY or not export.path.exists():
            raise Http404
        response = FileResponse(
            export.path.open("rb"),
            content_type="application/zip",
            as_attachment=True,
            filename=export.filename,
        )
        response["Cache-Control"] = "private, no-store"
        return response
