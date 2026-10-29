from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from apps.items.models import Item
from apps.items.serializers import ITEM_PREFETCH

from .layout import LayoutError, item_ids, migrate_layout, prune_layout, validate_layout
from .models import Board
from .serializers import BoardDetailSerializer, BoardSerializer


class BoardViewSet(viewsets.ModelViewSet):
    """
    Boards of the current user. `retrieve` returns the layout and its items;
    the layout is saved on its own (`PUT layout/`), guarded by the revision.
    """

    serializer_class = BoardSerializer

    def get_queryset(self):
        return Board.objects.filter(owner=self.request.user).annotate(
            item_count=Count("items")
        )

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

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
        time leave the inbox.
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


def etag(board):
    return {"ETag": f'"{board.revision}"'}
