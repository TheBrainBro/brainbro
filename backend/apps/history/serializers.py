from rest_framework import serializers

from apps.boards.layout import item_ids, migrate_layout
from apps.items.models import Item
from apps.items.serializers import ITEM_PREFETCH, ItemSerializer

from .models import Revision


class RevisionSerializer(serializers.ModelSerializer):
    """A revision in a list: who saved it and when, without its content."""

    # When the revision it brought back started.
    restored_from_at = serializers.DateTimeField(
        source="restored_from.created_at", read_only=True, default=None
    )

    class Meta:
        model = Revision
        fields = [
            "id",
            "item",
            "board",
            "title",
            "by",
            "via",
            "logo",
            "restored_from",
            "restored_from_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class RevisionDetailSerializer(RevisionSerializer):
    """
    One revision with its content: a note's body, or a board's layout (in the
    current schema) and the items on it that still exist.
    """

    layout = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()

    class Meta(RevisionSerializer.Meta):
        fields = [*RevisionSerializer.Meta.fields, "body", "layout", "items"]
        read_only_fields = fields

    def get_layout(self, revision):
        return migrate_layout(revision.layout) if revision.layout is not None else None

    def get_items(self, revision):
        if revision.layout is None:
            return None
        items = Item.objects.filter(
            owner_id=revision.owner_id, id__in=item_ids(migrate_layout(revision.layout))
        ).prefetch_related(*ITEM_PREFETCH)
        return ItemSerializer(items, many=True, context=self.context).data
