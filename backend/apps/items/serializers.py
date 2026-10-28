from django.db import models
from django.urls import reverse
from rest_framework import serializers

from .models import Collection, Item


class OwnedPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    """Only accepts objects owned by the requesting user."""

    def get_queryset(self):
        return super().get_queryset().filter(owner=self.context["request"].user)


class CollectionSerializer(serializers.ModelSerializer):
    # Annotated by the viewset; absent on freshly created collections.
    item_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Collection
        fields = [
            "id",
            "name",
            "kind",
            "color",
            "icon",
            "item_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

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


class ItemSerializer(serializers.ModelSerializer):
    collections = OwnedPrimaryKeyRelatedField(
        queryset=Collection.objects.all(), many=True, required=False
    )
    preview_image_url = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()

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
            "created_at",
            "updated_at",
        ]
        # Kind, URL and previews come from capture and the preview task.
        read_only_fields = [
            "kind",
            "url",
            "metadata",
            "preview_status",
            "created_at",
            "updated_at",
        ]

    def get_preview_image_url(self, item):
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
