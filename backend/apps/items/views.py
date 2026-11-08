import uuid

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import models, transaction
from django.db.models import Count, OuterRef, Q, Subquery
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from apps.collab.documents import body_written
from apps.events.changes import items_changed
from apps.public.pages import default_image, default_title, excerpt, page_preview
from apps.public.publishing import (
    MAX_SLUG,
    SlugTaken,
    is_valid_slug,
    publish,
    save_page,
    unpublish,
)
from apps.public.sites import public_url

from .albums import AlbumError, make_album, set_album_images, ungroup
from .capture import infer_item_fields
from .collection_images import make_square_image
from .models import Collection, CollectionItem, Item, NoteImage, NoteLink, rank_now
from .note_images import MAX_PASTED_SIZE
from .notes import sync_images
from .ordering import move_collection, move_in_collection, move_in_inbox
from .ranges import file_response
from .search import find
from .serializers import (
    ITEM_PREFETCH,
    AlbumSerializer,
    CollectionSerializer,
    ItemSerializer,
    NoteImageSerializer,
    OwnedPrimaryKeyRelatedField,
    TriageSerializer,
    check_parent,
    note_image_url,
)
from .tasks import (
    fetch_link_preview,
    generate_thumbnail,
    make_note_image_display,
)
from .titles import linkable_titles
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


class MoveSerializer(serializers.Serializer):
    after = serializers.UUIDField(allow_null=True, required=False, default=None)
    collection = OwnedPrimaryKeyRelatedField(
        queryset=Collection.objects.all(), required=False, allow_null=True
    )


class PageSerializer(serializers.Serializer):
    """A published note's page settings; empty ones take their default."""

    slug = serializers.CharField(max_length=MAX_SLUG, required=False)
    title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    description = serializers.CharField(
        max_length=300, required=False, allow_blank=True
    )
    # The `src` of one of the note's images, or "none".
    image = serializers.CharField(max_length=2048, required=False, allow_blank=True)

    def validate_slug(self, value):
        if not is_valid_slug(value):
            raise serializers.ValidationError(
                "Use lowercase letters, numbers and hyphens."
            )
        return value


def page_settings(note):
    """What the page settings show: the saved values, defaults and the preview."""
    preview = page_preview(note)
    default = default_image(note)
    url = public_url(note)
    return {
        "slug": note.public_slug,
        # What comes before the slug: `/@<handle>/`, or its blog's `https://<host>/`.
        "address": url[: url.rindex("/") + 1],
        "title": note.public_title,
        "description": note.public_description,
        "image": note.public_image,
        "defaults": {
            "title": default_title(note),
            "description": excerpt(note.body),
            "image": default.src if default else None,
        },
        "preview": {
            "title": preview.title,
            "description": preview.description,
            "image_url": note_image_url(preview.image) if preview.image else None,
        },
    }


class CollectionMoveSerializer(serializers.Serializer):
    # Where it goes: inside this collection, or at the top when null.
    parent = OwnedPrimaryKeyRelatedField(
        queryset=Collection.objects.all(), allow_null=True
    )
    after = serializers.UUIDField(allow_null=True, required=False, default=None)


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


def place_captured(item, collection=None):
    """
    Where something just captured goes: the inbox, or organized in
    `collection`. Starts its preview, if it gets one.
    """
    if collection:
        item.status = Item.Status.ORGANIZED
        item.save(update_fields=["status"])
        item.collections.add(collection)
    if item.preview_status == Item.PreviewStatus.PENDING:
        enqueue_preview(item)


def capture_text(owner, text, kind=None, collection=None):
    """A note or a link captured from `text`, as `infer_item_fields` decides."""
    fields = infer_item_fields(text, kind)
    if fields["kind"] == Item.Kind.LINK:
        fields["preview_status"] = Item.PreviewStatus.PENDING
    item = Item.objects.create(owner=owner, **fields)
    if item.kind == Item.Kind.NOTE:
        sync_images(item)
    place_captured(item, collection)
    return item


@transaction.atomic
def triage(items, action, collections=()):
    """
    Applies a `TriageSerializer.Action` to `items` (already the owner's).
    Returns how many were deleted, for `delete`.
    """
    Action = TriageSerializer.Action
    items_changed(items)
    if action == Action.DELETE:
        # Per-object signals still run, so preview images are removed.
        _, deleted = items.delete()
        return deleted.get("items.Item", 0)
    if action == Action.UNORGANIZE:
        CollectionItem.objects.filter(
            item__in=items, collection__in=collections
        ).delete()
        # Out of its last collection, it goes back to the inbox, on top.
        items.filter(status=Item.Status.ORGANIZED, collections__isnull=True).update(
            status=Item.Status.INBOX,
            inbox_rank=rank_now(),
            updated_at=timezone.now(),
        )
        return 0
    if action == Action.ORGANIZE:
        Through = Item.collections.through
        Through.objects.bulk_create(
            [
                Through(item_id=item_id, collection_id=collection.id)
                for item_id in items.values_list("id", flat=True)
                for collection in collections
            ],
            ignore_conflicts=True,
        )
    new_status = {
        Action.ORGANIZE: Item.Status.ORGANIZED,
        Action.ARCHIVE: Item.Status.ARCHIVED,
        Action.INBOX: Item.Status.INBOX,
    }[action]
    if new_status == Item.Status.INBOX:
        # Back in the inbox, on top; already there, it stays put.
        items.exclude(status=Item.Status.INBOX).update(inbox_rank=rank_now())
    if new_status != Item.Status.ORGANIZED:
        # Back to the inbox or archived, it leaves its collections
        # (undo organizes it into them again).
        CollectionItem.objects.filter(item__in=items).delete()
    items.update(status=new_status, updated_at=timezone.now())
    return 0


def by_origin(items, origin=None, app=None):
    """
    `origin`: "mine" (only the user made and edited them) or "assistants" (an
    app made or last edited them); `app`: that app did.
    """
    by_app = ~Q(created_by="") | ~Q(edited_by="")
    if origin == "mine":
        items = items.exclude(by_app)
    elif origin == "assistants":
        items = items.filter(by_app)
    if app:
        items = items.filter(Q(created_by=app) | Q(edited_by=app))
    return items


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
    `?collection=<id>`, `?q=<text>` (sorted by relevance), and who made or
    last edited it: `?origin=mine|assistants` or `?app=<name>`.
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
        item_status = params.get("status")
        if item_status:
            items = items.filter(status=item_status)
        if kinds := params.get("kind"):
            items = items.filter(kind__in=kinds.split(","))
        items = by_origin(items, params.get("origin"), params.get("app"))
        searching = self.action == "list" and params.get("q", "").strip()
        if searching:
            # Sample content is for the person using the app, not search results.
            items = items.filter(is_sample=False)
            items = find(items, searching).order_by("-rank", "-created_at")
        if collection := params.get("collection"):
            try:
                collection = uuid.UUID(collection)
            except ValueError:
                return items.none()
            return self._in_collection(items, collection, item_status, searching)
        if item_status == Item.Status.INBOX and not searching:
            items = items.order_by("-inbox_rank", "-created_at")
        elif item_status == Item.Status.ARCHIVED and not searching:
            # Last archived first.
            items = items.order_by("-updated_at")
        return items

    def _in_collection(self, items, collection, item_status, searching):
        items = items.filter(collections=collection)
        if not item_status:
            # What is in it now: items sent back or archived have left it.
            items = items.filter(status=Item.Status.ORGANIZED)
        if searching:
            return items
        # In the order it was sorted into, by hand.
        place = CollectionItem.objects.filter(
            item=OuterRef("pk"), collection=collection
        ).values("rank")[:1]
        return items.annotate(place=Subquery(place)).order_by("-place", "-created_at")

    def update(self, request, *args, **kwargs):
        """
        With `If-Match: "<version>"`, the save only applies if the title and
        body are still the ones the client started from; otherwise 412 with
        the current item, so the editor can show the conflict.

        The app edits notes live (`apps.collab`) instead; this is for clients
        without it, like an older app still cached on a device.
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
            body_written(item)

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
        collection = data.get("collection")
        if "file" in data:
            item = create_upload_item(request.user, data["file"], data["upload"])
            place_captured(item, collection)
        else:
            item = capture_text(
                request.user, data["text"], data.get("kind"), collection
            )
        return Response(self.get_serializer(item).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def apps(self, request):
        """The names of the apps that made or edited items, to filter by."""
        mine = Item.objects.filter(owner=request.user, is_sample=False)
        names = set(mine.values_list("created_by", flat=True).distinct())
        names |= set(mine.values_list("edited_by", flat=True).distinct())
        return Response({"apps": sorted(filter(None, names), key=str.lower)})

    @action(detail=False, methods=["get"], url_path="note-titles")
    def note_titles(self, request):
        """
        `[{"id", "title"}]`: the titles `[[Title]]` links find notes by, in the
        order they are tried (see `linkable_titles`), archived notes included.
        """
        notes = (
            Item.objects.filter(owner=request.user, kind=Item.Kind.NOTE)
            .only("id", "title", "body")
            .order_by("created_at")
        )
        return Response(
            [
                {"id": str(note_id), "title": title}
                for note_id, title in linkable_titles(notes)
            ]
        )

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
        mine = Item.objects.filter(owner=request.user, is_sample=False)
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
        """
        Organize, take out of collections, archive, send back to the inbox or
        delete several items.
        """
        payload = TriageSerializer(data=request.data, context={"request": request})
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        items = Item.objects.filter(owner=request.user, id__in=data["ids"])
        deleted = triage(items, data["action"], data.get("collections", []))
        if data["action"] == TriageSerializer.Action.DELETE:
            return Response({"deleted": deleted})
        updated = self.get_queryset().filter(id__in=data["ids"])
        return Response(self.get_serializer(updated, many=True).data)

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        """
        Puts the item right after `after` (an item id, or null for the top)
        in the inbox, or in `collection` when given.
        """
        item = self.get_object()
        payload = MoveSerializer(data=request.data, context={"request": request})
        payload.is_valid(raise_exception=True)
        after = payload.validated_data.get("after")
        collection = payload.validated_data.get("collection")
        if collection:
            if not item.collections.filter(id=collection.id).exists():
                raise serializers.ValidationError(
                    {"collection": "The item isn't in this collection."}
                )
            placed = move_in_collection(item, collection, after)
        else:
            if item.status != Item.Status.INBOX:
                raise serializers.ValidationError({"detail": "Not in the inbox."})
            placed = move_in_inbox(item, after)
        if not placed:
            raise serializers.ValidationError({"after": "Not in the same list."})
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["put", "delete"])
    def publication(self, request, pk=None):
        """
        PUT makes the note public at `/@<handle>/<slug>` (the slug it had, or one made
        from its title); DELETE makes it private again. Both return the note.
        """
        note = self._note()
        if request.method == "DELETE":
            unpublish(note)
        else:
            publish(note)
        return Response(self.get_serializer(note).data)

    @action(detail=True, methods=["get", "patch"])
    def page(self, request, pk=None):
        """
        The settings of the note's public page: `slug`, and how it shows in
        search results and shared links (`title`, `description`, `image`).
        PATCH changes some of them; empty ones go back to their default.
        """
        note = self._note()
        if request.method == "PATCH":
            payload = PageSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            try:
                save_page(note, payload.validated_data)
            except SlugTaken:
                raise serializers.ValidationError(
                    {"slug": "Another note already has this address."}
                ) from None
        return Response(page_settings(note))

    def _note(self):
        note = self.get_object()
        if note.kind != Item.Kind.NOTE:
            raise serializers.ValidationError(
                {"detail": "Only notes can be published."}
            )
        return note

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
        on our origin. Players still play audio and video from it, in parts.
        """
        item = self.get_object()
        if not item.file:
            raise Http404
        mime = item.metadata.get("mime") or "application/octet-stream"
        inline = item.kind == Item.Kind.IMAGE and mime in INLINE_TYPES
        response = file_response(
            request,
            item.file,
            content_type=mime,
            filename=item.metadata.get("filename") or item.file.name,
            as_attachment=not inline,
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


class NoteLinkViewSet(viewsets.GenericViewSet):
    """Serves the image of a card or embed link in a note (see `NoteLink`)."""

    def get_queryset(self):
        return NoteLink.objects.filter(owner=self.request.user)

    @action(detail=True, methods=["get"])
    def image(self, request, pk=None):
        link = self.get_object()
        if not link.image:
            raise Http404
        response = FileResponse(link.image.open("rb"), content_type="image/webp")
        response["X-Content-Type-Options"] = "nosniff"
        # The URL carries a per-file version, so the content never changes.
        response["Cache-Control"] = "private, max-age=31536000, immutable"
        return response


class CollectionDeleteSerializer(serializers.Serializer):
    """What happens to the items that are in no other collection."""

    class Items(models.TextChoices):
        INBOX = "inbox"  # back to the inbox, to sort again
        ARCHIVE = "archive"
        DELETE = "delete"

    items = serializers.ChoiceField(choices=Items.choices, default=Items.INBOX)


class CollectionImageSerializer(serializers.Serializer):
    # Checked by make_square_image, size first.
    file = serializers.FileField(allow_empty_file=False)


class CollectionViewSet(viewsets.ModelViewSet):
    serializer_class = CollectionSerializer

    def get_queryset(self):
        # Ordered here: Meta.ordering doesn't apply to an aggregate.
        return (
            Collection.objects.filter(owner=self.request.user)
            .annotate(
                item_count=Count("items", filter=Q(items__status=Item.Status.ORGANIZED))
            )
            .order_by("-rank", "name")
        )

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def destroy(self, request, *args, **kwargs):
        """
        `?items=inbox|archive|delete` (inbox by default) says what happens to
        the items only in this collection. Items in other collections too
        just leave this one. Archived items stay archived unless deleted.
        Its subcollections move up to its parent (or to the top).
        """
        options = CollectionDeleteSerializer(data=request.query_params)
        options.is_valid(raise_exception=True)
        Items = CollectionDeleteSerializer.Items
        choice = options.validated_data["items"]
        collection = self.get_object()

        with transaction.atomic():
            # Counted before filtering by this collection, or the count would
            # only see this one.
            only_here = (
                Item.objects.filter(owner=request.user)
                .annotate(placed=Count("collections"))
                .filter(collections=collection, placed=1)
            )
            ids = list(only_here.values_list("id", flat=True))
            orphans = Item.objects.filter(id__in=ids)
            if choice == Items.DELETE:
                # Per-object signals still run, so their files are removed.
                orphans.delete()
            else:
                new_status = {
                    Items.INBOX: Item.Status.INBOX,
                    Items.ARCHIVE: Item.Status.ARCHIVED,
                }[choice]
                orphans.filter(status=Item.Status.ORGANIZED).update(
                    status=new_status, updated_at=timezone.now()
                )
            collection.children.update(
                parent=collection.parent, updated_at=timezone.now()
            )
            collection.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        """
        Puts the collection inside `parent` (null: at the top), right after
        `after` (a collection there, or null for the top of it).
        """
        collection = self.get_object()
        payload = CollectionMoveSerializer(
            data=request.data, context={"request": request}
        )
        payload.is_valid(raise_exception=True)
        parent = payload.validated_data["parent"]
        try:
            check_parent(collection, parent)
        except serializers.ValidationError as error:
            raise serializers.ValidationError({"parent": error.detail}) from error
        if not move_collection(collection, parent, payload.validated_data["after"]):
            raise serializers.ValidationError({"after": "Not in the same collection."})
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get", "post", "delete"])
    def image(self, request, pk=None):
        """GET the image, POST a new one (multipart `file`), DELETE it."""
        collection = self.get_object()
        if request.method == "GET":
            if not collection.image:
                raise Http404
            response = FileResponse(
                collection.image.open("rb"), content_type="image/webp"
            )
            # The URL carries a per-file version, so the content never changes.
            response["Cache-Control"] = "private, max-age=31536000, immutable"
            return response

        old = collection.image.name if collection.image else None
        if request.method == "POST":
            upload = CollectionImageSerializer(data=request.data)
            upload.is_valid(raise_exception=True)
            data = make_square_image(upload.validated_data["file"])
            if data is None:
                raise serializers.ValidationError(
                    {"file": "Use a JPEG, PNG, GIF or WebP image under 2 MB."}
                )
            collection.image.save("image.webp", ContentFile(data), save=True)
        else:
            collection.image = ""
            collection.save(update_fields=["image", "updated_at"])
        if old:
            collection.image.storage.delete(old)
        return Response(self.get_serializer(self.get_queryset().get(pk=pk)).data)
