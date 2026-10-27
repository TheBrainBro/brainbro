from rest_framework import serializers

from .models import Collection, Item


class OwnedPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    """Only accepts objects owned by the requesting user."""

    def get_queryset(self):
        return super().get_queryset().filter(owner=self.context["request"].user)


class CollectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Collection
        fields = ["id", "name", "kind", "color", "icon", "created_at", "updated_at"]
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
