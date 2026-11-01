from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from apps.events.changes import changed
from apps.items.models import Item, rank_now
from apps.items.ordering import place
from apps.items.serializers import ITEM_PREFETCH

from .layout import LayoutError, item_ids, migrate_layout, prune_layout, validate_layout
from .models import Board
from .serializers import BoardDetailSerializer, BoardSerializer


class MoveSerializer(serializers.Serializer):
    after = serializers.UUIDField(allow_null=True, required=False, default=None)


class BoardViewSet(viewsets.ModelViewSet):
    """
    Boards of the current user. `retrieve` returns the layout and its items;
    the layout is saved on its own (`PUT layout/`), guarded by the revision.
    """

    serializer_class = BoardSerializer

    def get_queryset(self):
        # Ordered here: Meta.ordering doesn't apply to an aggregate.
        return (
            Board.objects.filter(owner=self.request.user)
            .annotate(item_count=Count("items"))
            .order_by("-rank", "-updated_at")
        )

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    @transaction.atomic
    def perform_destroy(self, board):
        placed = list(board.items.values_list("id", flat=True))
        board.delete()
        back_to_inbox_if_unplaced(placed)

    def retrieve(self, request, *args, **kwargs):
        return self.detail_response(self.get_object())

    def detail_response(self, board, response_status=status.HTTP_200_OK):
        items = board.items.filter(owner=self.request.user).prefetch_related(
            *ITEM_PREFETCH
        )
        layout = prune_layout(
            migrate_layout(board.layout), {str(item.id) for item in items}
        )
        data = BoardDetailSerializer(
            board,
            context={**self.get_serializer_context(), "layout": layout, "items": items},
        ).data
        return Response(data, status=response_status, headers=etag(board))

    @action(detail=True, methods=["put"])
    def layout(self, request, pk=None):
        """
        Replaces the layout. `If-Match: "<revision>"` is required: if someone
        saved since, 412 with the current board. Nodes of items that don't
        exist (or aren't yours) are dropped; items placed here for the first
        time leave the inbox, and items taken off it with nowhere else to be
        go back.
        """
        expected = request.headers.get("If-Match")
        if not expected:
            return Response(
                {"detail": "Send If-Match with the board's revision."},
                status=status.HTTP_428_PRECONDITION_REQUIRED,
            )
        try:
            layout = validate_layout(request.data)
        except LayoutError as error:
            return Response(
                {"detail": error.message, "path": error.path},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            board = get_object_or_404(
                Board.objects.select_for_update(), pk=pk, owner=request.user
            )
            if expected.strip().strip('"') != str(board.revision):
                return self.detail_response(board, status.HTTP_412_PRECONDITION_FAILED)
            owned = {
                str(item_id)
                for item_id in Item.objects.filter(
                    owner=request.user, id__in=item_ids(layout)
                ).values_list("id", flat=True)
            }
            layout = prune_layout(layout, owned)
            before = {
                str(item_id) for item_id in board.items.values_list("id", flat=True)
            }
            Item.objects.filter(id__in=owned - before, status=Item.Status.INBOX).update(
                status=Item.Status.ORGANIZED, updated_at=timezone.now()
            )
            board.items.set(owned)
            back_to_inbox_if_unplaced(before - owned)
            board.layout = layout
            board.revision += 1
            board.save(update_fields=["layout", "revision", "updated_at"])

        return Response(
            {
                "revision": board.revision,
                "layout": layout,
                "updated_at": board.updated_at,
            },
            headers=etag(board),
        )

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        """Puts the board right after `after` (a board id, or null for the top)."""
        board = self.get_object()
        payload = MoveSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        if not move_board(board, payload.validated_data["after"]):
            raise serializers.ValidationError({"after": "Not one of your boards."})
        return Response(status=status.HTTP_204_NO_CONTENT)


@transaction.atomic
def move_board(board, after):
    """Puts `board` right after `after` (a board id) or on top (see `place`)."""
    rows = list(
        Board.objects.select_for_update()
        .filter(owner=board.owner)
        .exclude(id=board.id)
        .order_by("-rank", "-updated_at")
        .values_list("id", "rank")
    )

    def set_rank(board_id, rank):
        # Not `updated_at`: a board's place isn't an edit of it.
        Board.objects.filter(id=board_id).update(rank=rank)

    changed(board.owner_id)
    return place(rows, board.id, after, set_rank)


def back_to_inbox_if_unplaced(item_ids):
    """
    Organized items left on no board and in no collection go back to the top
    of the inbox: otherwise they'd show up nowhere.
    """
    Item.objects.filter(
        id__in=item_ids,
        status=Item.Status.ORGANIZED,
        boards__isnull=True,
        collections__isnull=True,
    ).update(status=Item.Status.INBOX, inbox_rank=rank_now(), updated_at=timezone.now())


def etag(board):
    return {"ETag": f'"{board.revision}"'}
