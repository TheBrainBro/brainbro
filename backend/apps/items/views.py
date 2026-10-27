import uuid

from django.db import transaction
from django.http import FileResponse, Http404
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .capture import infer_item_fields
from .models import Item
from .serializers import ItemSerializer
from .tasks import fetch_link_preview


class CaptureSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=100_000, trim_whitespace=True)


def enqueue_preview(item):
    # After commit, so the worker never looks for a row it can't see yet.
    transaction.on_commit(lambda: fetch_link_preview.delay(str(item.id)))


class ItemViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    Items of the current user. They are created through `capture`, which
    infers the type; everything else is reading and triage.

    Filters: `?status=inbox|organized|archived`, `?collection=<id>`.
    """

    serializer_class = ItemSerializer

    def get_queryset(self):
        items = Item.objects.filter(owner=self.request.user).prefetch_related(
            "collections"
        )
        if item_status := self.request.query_params.get("status"):
            items = items.filter(status=item_status)
        if collection := self.request.query_params.get("collection"):
            try:
                items = items.filter(collections=uuid.UUID(collection))
            except ValueError:
                return items.none()
        return items

    @action(detail=False, methods=["post"])
    def capture(self, request):
        """Universal capture: drop text or a URL; it lands in the inbox."""
        payload = CaptureSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        fields = infer_item_fields(payload.validated_data["text"])
        if fields["kind"] == Item.Kind.LINK:
            fields["preview_status"] = Item.PreviewStatus.PENDING
        item = Item.objects.create(owner=request.user, **fields)
        if item.kind == Item.Kind.LINK:
            enqueue_preview(item)
        return Response(self.get_serializer(item).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="refresh-preview")
    def refresh_preview(self, request, pk=None):
        item = self.get_object()
        if item.kind != Item.Kind.LINK:
            return Response(
                {"detail": "Only links have previews."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        item.preview_status = Item.PreviewStatus.PENDING
        item.save(update_fields=["preview_status", "updated_at"])
        enqueue_preview(item)
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=["get"], url_path="preview-image")
    def preview_image(self, request, pk=None):
        item = self.get_object()
        if not item.preview_image:
            raise Http404
        response = FileResponse(
            item.preview_image.open("rb"), content_type="image/webp"
        )
        # The URL carries a per-file version, so the content never changes.
        response["Cache-Control"] = "private, max-age=31536000, immutable"
        return response
