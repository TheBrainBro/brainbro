from rest_framework import serializers

from apps.items.serializers import ItemSerializer

from .models import Board


class BoardSerializer(serializers.ModelSerializer):
    """A board without its layout: lists, creating and renaming."""

    # Annotated by the viewset; absent on freshly created boards.
    item_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Board
        fields = [
            "id",
            "title",
            "is_sample",
            "item_count",
            "revision",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["is_sample", "revision", "created_at", "updated_at"]


class BoardDetailSerializer(BoardSerializer):
    """
    Everything needed to open a board in one request: the layout and the
    items its nodes point at. The view passes the layout already migrated
    and pruned, and the items, in the context.
    """

    layout = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()

    class Meta(BoardSerializer.Meta):
        fields = [*BoardSerializer.Meta.fields, "layout", "items"]

    def get_layout(self, board):
        return self.context["layout"]

    def get_items(self, board):
        return ItemSerializer(
            self.context["items"], many=True, context=self.context
        ).data
