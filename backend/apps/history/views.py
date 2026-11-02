import uuid

from django.db import transaction
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.boards.layout import migrate_layout, validate_layout
from apps.boards.models import Board
from apps.boards.views import board_detail, etag, save_layout
from apps.collab.documents import body_written
from apps.items.models import Item
from apps.items.notes import sync_images
from apps.items.serializers import ITEM_PREFETCH, ItemSerializer

from .models import Revision
from .recording import restoring
from .serializers import RevisionDetailSerializer, RevisionSerializer


class RevisionViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """
    The history of a note (`?item=<id>`) or a board (`?board=<id>`), newest
    first; one revision with its content; and `restore`, which saves a
    revision's content again as a new one.
    """

    def get_queryset(self):
        revisions = Revision.objects.filter(owner=self.request.user).select_related(
            "restored_from"
        )
        if self.action != "list":
            return revisions
        params = self.request.query_params
        item, board = params.get("item"), params.get("board")
        if bool(item) == bool(board):
            raise serializers.ValidationError({"detail": "Send either item or board."})
        try:
            if item:
                return revisions.filter(item=uuid.UUID(item))
            return revisions.filter(board=uuid.UUID(board))
        except ValueError:
            return revisions.none()

    def get_serializer_class(self):
        if self.action == "list":
            return RevisionSerializer
        return RevisionDetailSerializer

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        """
        Saves the revision's content again (a note's title and body, a
        board's title and layout), as a new revision. Returns the note, or
        the board as `retrieve` does.
        """
        revision = self.get_object()
        if revision.item_id:
            return Response(self.restore_note(revision))
        board = self.restore_board(revision)
        return Response(
            board_detail(board, self.get_serializer_context()), headers=etag(board)
        )

    def restore_note(self, revision):
        with transaction.atomic(), restoring(revision):
            note = Item.objects.select_for_update().get(id=revision.item_id)
            note.title, note.body = revision.title, revision.body
            note.mark_edited()
            note.save(update_fields=["title", "body", *Item.EDIT_FIELDS, "updated_at"])
            sync_images(note)
            # Open in the app: it changes there live, like an assistant's edit.
            body_written(note)
        note = Item.objects.prefetch_related(*ITEM_PREFETCH).get(id=note.id)
        return ItemSerializer(note, context=self.get_serializer_context()).data

    def restore_board(self, revision):
        with transaction.atomic(), restoring(revision):
            board = Board.objects.select_for_update().get(id=revision.board_id)
            # Where the board is looked at from stays as it is now.
            viewport = migrate_layout(board.layout)["viewport"]
            layout = migrate_layout(revision.layout)
            board.title = revision.title
            save_layout(
                board, validate_layout({**layout, "viewport": viewport}), ["title"]
            )
        return board
