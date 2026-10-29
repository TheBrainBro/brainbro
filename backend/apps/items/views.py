import uuid

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from .capture import infer_item_fields
from .models import Collection, Item
from .serializers import CollectionSerializer, ItemSerializer, TriageSerializer
from .tasks import fetch_link_preview, generate_thumbnail
from .uploads import INLINE_TYPES, UploadTooLarge, has_thumbnail, inspect_upload


class CaptureSerializer(serializers.Serializer):
    """
    Either `text` (JSON or form) or one `file` (multipart). `kind: "note"`
    skips inference and keeps the text as written.
    """

    # Not trimmed here: inference strips it, and notes keep it as written.
    text = serializers.CharField(
        max_length=100_000, trim_whitespace=False, required=False
    )
    kind = serializers.ChoiceField(choices=[Item.Kind.NOTE], required=False)
    file = serializers.FileField(required=False, allow_empty_file=False)

    def validate_text(self, value):
        if not value.strip():
            raise serializers.ValidationError("This field may not be blank.")
        return value

    def validate(self, data):
        if ("text" in data) == ("file" in data):
            raise serializers.ValidationError("Send either text or a file.")
        if "file" in data:
            try:
                data["upload"] = inspect_upload(data["file"])
            except UploadTooLarge:
                limit = settings.UPLOAD_MAX_SIZE // (1024 * 1024)
                raise serializers.ValidationError(
                    {"file": f"The file is too large (max {limit} MB)."}
                ) from None
        return data


def enqueue_preview(item):
    # After commit, so the worker never looks for a row it can't see yet.
    task = fetch_link_preview if item.kind == Item.Kind.LINK else generate_thumbnail
    transaction.on_commit(lambda: task.delay(str(item.id)))


def create_upload_item(owner, file, upload):
    item = Item(
        owner=owner,
        kind=upload.kind,
        metadata=upload.metadata,
        title="" if upload.kind == Item.Kind.IMAGE else upload.metadata["filename"],
    )
    if has_thumbnail(item):
        item.preview_status = Item.PreviewStatus.PENDING
    # Uploads spooled to disk are moved into storage, not copied.
    item.file.save(f"upload.{upload.extension}", file, save=False)
    item.save()
    return item


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
        params = self.request.query_params
        if item_status := params.get("status"):
            items = items.filter(status=item_status)
        if kinds := params.get("kind"):
            items = items.filter(kind__in=kinds.split(","))
        # A plain substring match for pickers; full-text search is #26.
        if text := params.get("q", "").strip():
            items = items.filter(
                Q(title__icontains=text)
                | Q(body__icontains=text)
                | Q(url__icontains=text)
                | Q(metadata__title__icontains=text)
                | Q(metadata__filename__icontains=text)
            )
        if collection := params.get("collection"):
            try:
                items = items.filter(collections=uuid.UUID(collection))
            except ValueError:
                return items.none()
        return items

    def update(self, request, *args, **kwargs):
        """
        With `If-Match: "<version>"`, the save only applies if the title and
        body are still the ones the client started from; otherwise 412 with
        the current item, so the editor can show the conflict.
        """
        expected = request.headers.get("If-Match")
        with transaction.atomic():
            if expected:
                item = get_object_or_404(
                    Item.objects.select_for_update(),
                    pk=kwargs["pk"],
                    owner=request.user,
                )
                if expected.strip().strip('"') != item.version:
                    return Response(
                        self.get_serializer(item).data,
                        status=status.HTTP_412_PRECONDITION_FAILED,
                    )
            return super().update(request, *args, **kwargs)

    @action(detail=False, methods=["post"])
    def capture(self, request):
        """
        Universal capture: drop text, a URL or a file; it lands in the inbox.
        Images become `image` items (thumbnail made in the background), any
        other file a `file` item.
        """
        payload = CaptureSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        if "file" in data:
            item = create_upload_item(request.user, data["file"], data["upload"])
        else:
            fields = infer_item_fields(data["text"], data.get("kind"))
            if fields["kind"] == Item.Kind.LINK:
                fields["preview_status"] = Item.PreviewStatus.PENDING
            item = Item.objects.create(owner=request.user, **fields)
        if item.preview_status == Item.PreviewStatus.PENDING:
            enqueue_preview(item)
        return Response(self.get_serializer(item).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"])
    def triage(self, request):
        """Organize, archive, send back to the inbox or delete several items."""
        payload = TriageSerializer(data=request.data, context={"request": request})
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        items = Item.objects.filter(owner=request.user, id__in=data["ids"])
        Action = TriageSerializer.Action

        with transaction.atomic():
            if data["action"] == Action.DELETE:
                # Per-object signals still run, so preview images are removed.
                _, deleted = items.delete()
                return Response({"deleted": deleted.get("items.Item", 0)})
            if data["action"] == Action.ORGANIZE:
                Through = Item.collections.through
                Through.objects.bulk_create(
                    [
                        Through(item_id=item_id, collection_id=collection.id)
                        for item_id in items.values_list("id", flat=True)
                        for collection in data["collections"]
                    ],
                    ignore_conflicts=True,
                )
            new_status = {
                Action.ORGANIZE: Item.Status.ORGANIZED,
                Action.ARCHIVE: Item.Status.ARCHIVED,
                Action.INBOX: Item.Status.INBOX,
            }[data["action"]]
            items.update(status=new_status, updated_at=timezone.now())

        updated = self.get_queryset().filter(id__in=data["ids"])
        return Response(self.get_serializer(updated, many=True).data)

    @action(detail=True, methods=["post"], url_path="refresh-preview")
    def refresh_preview(self, request, pk=None):
        item = self.get_object()
        if item.kind != Item.Kind.LINK and not has_thumbnail(item):
            return Response(
                {"detail": "Only links, images and PDFs have previews."},
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

    @action(detail=True, methods=["get"])
    def file(self, request, pk=None):
        """
        The uploaded original. Only known raster images are shown inline;
        everything else is a download, so nothing uploaded can run as a page
        on our origin.
        """
        item = self.get_object()
        if not item.file:
            raise Http404
        mime = item.metadata.get("mime") or "application/octet-stream"
        inline = item.kind == Item.Kind.IMAGE and mime in INLINE_TYPES
        response = FileResponse(
            item.file.open("rb"),
            content_type=mime,
            as_attachment=not inline,
            filename=item.metadata.get("filename") or item.file.name,
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        response["Cache-Control"] = "private, max-age=31536000, immutable"
        return response


class CollectionViewSet(viewsets.ModelViewSet):
    serializer_class = CollectionSerializer

    def get_queryset(self):
        return Collection.objects.filter(owner=self.request.user).annotate(
            item_count=Count("items")
        )

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
