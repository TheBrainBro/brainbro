import uuid

from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .capture import infer_item_fields
from .models import Item
from .serializers import ItemSerializer


class CaptureSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=100_000, trim_whitespace=True)


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
        item = Item.objects.create(
            owner=request.user, **infer_item_fields(payload.validated_data["text"])
        )
        return Response(self.get_serializer(item).data, status=status.HTTP_201_CREATED)
