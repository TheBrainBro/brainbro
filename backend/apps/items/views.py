import uuid

from django.conf import settings
from django.db import transaction
from django.db.models import Count
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from .albums import AlbumError, make_album, set_album_images, ungroup
from .capture import infer_item_fields
from .models import Collection, Item, NoteImage
from .note_images import MAX_PASTED_SIZE, sync_note_images
from .search import find
from .serializers import (
    ITEM_PREFETCH,
    AlbumSerializer,
    CollectionSerializer,
    ItemSerializer,
    NoteImageSerializer,
    OwnedPrimaryKeyRelatedField,
    TriageSerializer,
)
from .tasks import (
    fetch_link_preview,
    fetch_note_images,
    generate_thumbnail,
    make_note_image_display,
)
from .uploads import INLINE_TYPES, UploadTooLarge, has_thumbnail, inspect_upload


class CaptureSerializer(serializers.Serializer):
    """
    Either `text` (JSON or form) or one `file` (multipart). `kind: "note"`
    skips inference and keeps the text as written. With `collection`, the
    item lands organized in it instead of in the inbox.
    """

    # Not trimmed here: inference strips it, and notes keep it as written.
    text = serializers.CharField(
        max_length=100_000, trim_whitespace=False, required=False
    )
    kind = serializers.ChoiceField(choices=[Item.Kind.NOTE], required=False)
    file = serializers.FileField(required=False, allow_empty_file=False)
    collection = OwnedPrimaryKeyRelatedField(
        queryset=Collection.objects.all(), required=False
    )

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


def sync_images(note):
    if sync_note_images(note):
        transaction.on_commit(lambda: fetch_note_images.delay(str(note.id)))


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


SEARCH_LIMIT = 20


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

    Filters: `?status=inbox|organized|archived`, `?kind=note,link`,
    `?collection=<id>`, `?q=<text>` (sorted by relevance).
    """

    serializer_class = ItemSerializer

    def get_queryset(self):
        items = Item.objects.filter(owner=self.request.user).prefetch_related(
            *ITEM_PREFETCH
        )
        # An album's images show up through it, not on their own.
        if self.action == "list":
            items = items.filter(album__isnull=True)
        params = self.request.query_params
        if item_status := params.get("status"):
            items = items.filter(status=item_status)
        if kinds := params.get("kind"):
            items = items.filter(kind__in=kinds.split(","))
        if self.action == "list" and (text := params.get("q", "").strip()):
            items = find(items, text).order_by("-rank", "-created_at")
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

    def perform_update(self, serializer):
        item = serializer.save()
        if item.kind == Item.Kind.NOTE and "body" in serializer.validated_data:
            sync_images(item)

    @action(detail=False, methods=["post"])
    def capture(self, request):
        """
        Universal capture: drop text, a URL or a file; it lands in the inbox,
        or in `collection` when one is open. Images become `image` items
        (thumbnail made in the background), any other file a `file` item.
        """
        payload = CaptureSerializer(data=request.data, context={"request": request})
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        if "file" in data:
            item = create_upload_item(request.user, data["file"], data["upload"])
        else:
            fields = infer_item_fields(data["text"], data.get("kind"))
            if fields["kind"] == Item.Kind.LINK:
                fields["preview_status"] = Item.PreviewStatus.PENDING
            item = Item.objects.create(owner=request.user, **fields)
            if item.kind == Item.Kind.NOTE:
                sync_images(item)
        if collection := data.get("collection"):
            item.status = Item.Status.ORGANIZED
            item.save(update_fields=["status"])
            item.collections.add(collection)
        if item.preview_status == Item.PreviewStatus.PENDING:
            enqueue_preview(item)
        return Response(self.get_serializer(item).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def search(self, request):
        """
        `?q=<text>`: the best matches, archived included, as
        `[{"item", "album_image"}]`. An album's image shows up as its album,
        with `album_image` saying which one matched.
        """
        text = request.query_params.get("q", "").strip()
        if not text:
            return Response([])
        mine = Item.objects.filter(owner=request.user)
        matches = find(mine, text).order_by("-rank", "-created_at")
        found = {}
        # More rows than needed: several images of one album take one place.
        for item_id, album_id in matches.values_list("id", "album_id")[
            : SEARCH_LIMIT * 5
        ]:
            if album_id:
                found.setdefault(album_id, item_id)
            else:
                found.setdefault(item_id, None)
            if len(found) == SEARCH_LIMIT:
                break
        items = mine.prefetch_related(*ITEM_PREFETCH).in_bulk(found)
        return Response(
            [
                {
                    "item": self.get_serializer(items[item_id]).data,
                    "album_image": found[item_id],
                }
                for item_id in found
            ]
        )

    @action(detail=False, methods=["post"])
    def albums(self, request):
        """`{"items": [image ids, in order], "title"?}`: a new album, in the inbox."""
        payload = AlbumSerializer(data=request.data, context={"request": request})
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        try:
            album = make_album(request.user, data["items"], data.get("title", ""))
        except AlbumError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        album = self.get_queryset().get(id=album.id)
        return Response(self.get_serializer(album).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["put"], url_path="album-items")
    def album_items(self, request, pk=None):
        """
        `{"items": [...]}`: what the album holds, in order. Images left out go
        back on their own.
        """
        album = self._album()
        payload = AlbumSerializer(data=request.data, context={"request": request})
        payload.is_valid(raise_exception=True)
        try:
            set_album_images(album, payload.validated_data["items"])
        except AlbumError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(self.get_queryset().get(id=album.id)).data)

    @action(detail=True, methods=["post"])
    def ungroup(self, request, pk=None):
        """Takes the album away and returns its images, now on their own."""
        images = ungroup(self._album())
        fresh = self.get_queryset().filter(id__in=[image.id for image in images])
        return Response(self.get_serializer(fresh, many=True).data)

    def _album(self):
        album = self.get_object()
        if album.kind != Item.Kind.ALBUM:
            raise serializers.ValidationError({"detail": "Not an album."})
        return album

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


class NoteImageUploadSerializer(serializers.Serializer):
    file = serializers.FileField(allow_empty_file=False)

    def validate(self, data):
        limit = MAX_PASTED_SIZE // (1024 * 1024)
        too_large = {"file": f"The image is too large (max {limit} MB)."}
        if data["file"].size > MAX_PASTED_SIZE:
            raise serializers.ValidationError(too_large)
        try:
            data["upload"] = inspect_upload(data["file"])
        except UploadTooLarge:
            raise serializers.ValidationError(too_large) from None
        if data["upload"].kind != Item.Kind.IMAGE:
            raise serializers.ValidationError({"file": "Only images can go in a note."})
        return data


class NoteImageViewSet(mixins.CreateModelMixin, viewsets.GenericViewSet):
    """
    Images pasted or dropped into a note are uploaded here first; the note
    then links them by the returned `src`. `file` serves the copy the app
    shows of any image in a note, pasted or remote.
    """

    serializer_class = NoteImageSerializer

    def get_queryset(self):
        return NoteImage.objects.filter(owner=self.request.user)

    def create(self, request):
        payload = NoteImageUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        upload = data["upload"]
        # Unused until a note saves the link to it.
        image = NoteImage(
            owner=request.user,
            source=NoteImage.Source.PASTED,
            metadata=upload.metadata,
            unused_since=timezone.now(),
        )
        image.src = f"attachments/{image.id}.{upload.extension}"
        image.original.save(f"original.{upload.extension}", data["file"], save=False)
        image.save()
        transaction.on_commit(lambda: make_note_image_display.delay(str(image.id)))
        return Response(self.get_serializer(image).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def file(self, request, pk=None):
        image = self.get_object()
        if not image.image:
            raise Http404
        response = FileResponse(image.image.open("rb"), content_type="image/webp")
        response["X-Content-Type-Options"] = "nosniff"
        # The URL carries a per-file version, so the content never changes.
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
