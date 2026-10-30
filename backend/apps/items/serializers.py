from django.db import models
from django.urls import reverse
from rest_framework import serializers

from .models import Collection, Item, NoteImage


class OwnedPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    """Only accepts objects owned by the requesting user."""

    def get_queryset(self):
        return super().get_queryset().filter(owner=self.context["request"].user)


class CollectionSerializer(serializers.ModelSerializer):
    # Annotated by the viewset; absent on freshly created collections.
    item_count = serializers.IntegerField(read_only=True, default=0)
    # Set through `POST /collections/<id>/image/`.
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Collection
        fields = [
            "id",
            "name",
            "kind",
            "color",
            "icon",
            "image_url",
            "item_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_image_url(self, collection):
        if not collection.image:
            return None
        # Authenticated, and the file name busts the cache.
        path = reverse("collection-image", args=[collection.id])
        return f"{path}?v={collection.image.name.rsplit('/', 1)[-1]}"

    def validate_color(self, value):
        if value and not (
            len(value) == 7
            and value[0] == "#"
            and all(c in "0123456789abcdefABCDEF" for c in value[1:])
        ):
            raise serializers.ValidationError("Use a hex color like #3b82f6.")
        return value.lower()

    def validate_name(self, value):
        owner = self.context["request"].user
        clash = Collection.objects.filter(owner=owner, name__iexact=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A collection with this name exists.")
        return value


def album_images(album):
    # Sorted here, not in the query: the prefetched images are reused.
    return sorted(album.album_items.all(), key=lambda image: image.album_position)


# What serializing items reads besides the row: prefetch it with them.
ITEM_PREFETCH = (
    "collections",
    "album_items",
    "album_items__collections",
    "note_images",
    "note_links",
)


def note_image_url(image):
    if not image.image:
        return None
    # Like preview images: authenticated, and the file name busts the cache.
    path = reverse("note-image-file", args=[image.id])
    return f"{path}?v={image.image.name.rsplit('/', 1)[-1]}"


def note_link_preview(link):
    """What a card shows: never the site's own image URL, only our copy."""
    meta = link.metadata
    image_url = None
    if link.image:
        path = reverse("note-link-image", args=[link.id])
        image_url = f"{path}?v={link.image.name.rsplit('/', 1)[-1]}"
    return {
        "status": link.status,
        "title": meta.get("title", ""),
        "description": meta.get("description", ""),
        "site_name": meta.get("site_name", ""),
        "image_url": image_url,
    }


class NoteImageSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = NoteImage
        fields = ["id", "src", "status", "url"]
        read_only_fields = fields

    def get_url(self, image):
        return note_image_url(image)


class ItemSerializer(serializers.ModelSerializer):
    collections = OwnedPrimaryKeyRelatedField(
        queryset=Collection.objects.all(), many=True, required=False
    )
    preview_image_url = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    version = serializers.CharField(read_only=True)
    # Albums only: their images, in order.
    album_items = serializers.SerializerMethodField()
    # Notes only: the stored copy of each image, by `src` as in the Markdown.
    images = serializers.SerializerMethodField()
    # Notes only: the preview of each card or embed link, by URL.
    links = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = [
            "id",
            "kind",
            "status",
            "title",
            "body",
            "url",
            "metadata",
            "preview_status",
            "preview_image_url",
            "file_url",
            "collections",
            "album",
            "album_items",
            "images",
            "links",
            "version",
            "created_at",
            "updated_at",
        ]
        # Markdown is stored exactly as written: leading indentation and
        # trailing newlines are part of it.
        extra_kwargs = {"body": {"trim_whitespace": False}}
        # Kind, URL and previews come from capture and the preview task.
        read_only_fields = [
            "kind",
            "url",
            "metadata",
            "preview_status",
            "album",
            "created_at",
            "updated_at",
        ]

    def get_album_items(self, item):
        if item.kind != Item.Kind.ALBUM:
            return None
        return ItemSerializer(album_images(item), many=True, context=self.context).data

    def get_links(self, item):
        if item.kind != Item.Kind.NOTE:
            return None
        return {link.url: note_link_preview(link) for link in item.note_links.all()}

    def get_images(self, item):
        if item.kind != Item.Kind.NOTE:
            return None
        return {
            image.src: {"status": image.status, "url": note_image_url(image)}
            for image in item.note_images.all()
        }

    def get_preview_image_url(self, item):
        if item.kind == Item.Kind.ALBUM:
            # Its cover: the first image's thumbnail.
            images = album_images(item)
            return self.get_preview_image_url(images[0]) if images else None
        if not item.preview_image:
            return None
        # Uploads are never public: the image goes through an authenticated
        # view. The file name changes on every fetch, so it doubles as a
        # cache buster.
        path = reverse("item-preview-image", args=[item.id])
        return f"{path}?v={item.preview_image.name.rsplit('/', 1)[-1]}"

    def get_file_url(self, item):
        if not item.file:
            return None
        path = reverse("item-file", args=[item.id])
        return f"{path}?v={item.file.name.rsplit('/', 1)[-1]}"


class AlbumSerializer(serializers.Serializer):
    """Images for an album, in order."""

    items = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=500
    )
    title = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate_items(self, ids):
        if len(set(ids)) != len(ids):
            raise serializers.ValidationError("An image appears twice.")
        owner = self.context["request"].user
        found = {item.id: item for item in Item.objects.filter(owner=owner, id__in=ids)}
        if len(found) != len(ids):
            raise serializers.ValidationError("No such item.")
        return [found[item_id] for item_id in ids]


class TriageSerializer(serializers.Serializer):
    """Apply one triage action to several items at once."""

    class Action(models.TextChoices):
        ORGANIZE = "organize"  # add to collections, out of the inbox
        ARCHIVE = "archive"
        INBOX = "inbox"  # back to the inbox
        DELETE = "delete"

    ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=500
    )
    action = serializers.ChoiceField(choices=Action.choices)
    collections = OwnedPrimaryKeyRelatedField(
        queryset=Collection.objects.all(), many=True, required=False
    )

    def validate(self, data):
        if data["action"] == self.Action.ORGANIZE and not data.get("collections"):
            raise serializers.ValidationError(
                {"collections": "Pick at least one collection."}
            )
        return data
