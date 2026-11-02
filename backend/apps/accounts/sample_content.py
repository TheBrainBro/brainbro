"""The small, explicitly marked starter shared by every new BrainBro account."""

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from apps.boards.layout import empty_layout
from apps.boards.models import Board
from apps.boards.views import back_to_inbox_if_unplaced
from apps.events.changes import changed
from apps.items.models import Collection, CollectionItem, Item, rank_now
from apps.items.uploads import make_thumbnail

from .models import Profile


@transaction.atomic
def create_sample_content(user, mcp_url):
    """Make the starter once. Calling this again never duplicates it."""
    profile, _ = Profile.objects.select_for_update().get_or_create(user=user)
    if profile.sample_content_created_at:
        return

    descriptions = (
        (
            "Projects",
            Collection.Kind.PROJECT,
            "Outcomes with a finish line. Keep plans and next steps here.",
        ),
        (
            "Areas",
            Collection.Kind.AREA,
            "Ongoing parts of life that need care. Keep responsibilities and "
            "routines here.",
        ),
        (
            "Resources",
            Collection.Kind.RESOURCE,
            "Topics you may return to. Keep references and useful ideas here.",
        ),
        (
            "Archives",
            Collection.Kind.RESOURCE,
            "Finished or inactive things worth keeping. Move them here when "
            "they are done.",
        ),
    )
    collections = {}
    for name, kind, note in descriptions:
        collection = Collection.objects.create(
            owner=user, name=name, kind=kind, is_sample=True
        )
        collections[name] = collection
        guide = Item.objects.create(
            owner=user,
            kind=Item.Kind.NOTE,
            title=f"About {name}",
            body=note,
            status=Item.Status.ORGANIZED,
            is_sample=True,
        )
        CollectionItem.objects.create(
            item=guide, collection=collection, rank=rank_now()
        )

    note = Item.objects.create(
        owner=user,
        kind=Item.Kind.NOTE,
        title="A note to try",
        body=(
            "This is a sample note. Drag me to a collection, or archive me "
            "when you are done."
        ),
        is_sample=True,
    )
    link = Item.objects.create(
        owner=user,
        kind=Item.Kind.LINK,
        url="https://brainbro.app",
        title="BrainBro",
        metadata={"title": "BrainBro", "description": "Drop it now, sort it later."},
        is_sample=True,
    )
    picture = Item(
        owner=user,
        kind=Item.Kind.IMAGE,
        title="A sample image",
        body="Drag me to a collection, or archive me.",
        metadata={"filename": "sample-image.png", "mime": "image/png", "size": 68},
        is_sample=True,
    )
    # A real, tiny PNG so the example behaves like an uploaded image.
    image_data = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000b49444154789c636000020000050001a5f645400000000049454e44ae426082"
    )
    picture.file.save(
        "sample-image.png",
        ContentFile(image_data),
        save=True,
    )
    if thumbnail := make_thumbnail(picture):
        picture.preview_image.save(
            "sample-image.webp", ContentFile(thumbnail), save=False
        )
        picture.preview_status = Item.PreviewStatus.READY
        picture.metadata = {
            **picture.metadata,
            "size": len(image_data),
            "width": 1,
            "height": 1,
        }
        picture.save(
            update_fields=["preview_image", "preview_status", "metadata", "updated_at"]
        )
    Item.objects.create(
        owner=user,
        kind=Item.Kind.NOTE,
        title="Connect your AI",
        body=(
            "Add BrainBro as an MCP connector in your AI assistant, then sign "
            "in and allow access. "
            "Copy the ready-to-paste prompt from Settings → AI assistants.\n\n"
            "I use BrainBro, a self-hosted second brain, as shared memory "
            "across my AI assistants. "
            "Help me connect you to it.\n\n"
            "1. Read how BrainBro works with assistants: https://github.com/TheBrainBro/brainbro/blob/main/docs/mcp.md\n"
            f"2. Its MCP server is {mcp_url}.\n"
            "3. Walk me through signing in and allowing access.\n"
            "4. Once connected, list my inbox to check it works.\n\n"
            "Search BrainBro before answering about my notes or plans, save "
            "what I ask you to remember, "
            "and read a note before editing it."
        ),
        is_sample=True,
    )
    # They remain clearly visible in the inbox while the collections are ready to try.
    board = Board.objects.create(
        owner=user,
        title="A few ideas",
        is_sample=True,
        layout={
            **empty_layout(),
            "nodes": [
                {
                    "id": "sample-note",
                    "type": "item",
                    "item": str(note.id),
                    "x": 0,
                    "y": 0,
                    "w": 280.0,
                    "h": None,
                    "parent": None,
                },
                {
                    "id": "sample-link",
                    "type": "item",
                    "item": str(link.id),
                    "x": 330,
                    "y": 0,
                    "w": 340.0,
                    "h": None,
                    "parent": None,
                },
                {
                    "id": "sample-sticky",
                    "type": "sticky",
                    "text": "Drag me to a collection",
                    "x": 0,
                    "y": 260,
                    "w": 220.0,
                    "h": 180.0,
                    "parent": None,
                    "color": "#f5d0fe",
                },
            ],
        },
    )
    board.items.add(note, link)
    profile.sample_content_created_at = timezone.now()
    profile.save(update_fields=["sample_content_created_at", "updated_at"])


@transaction.atomic
def remove_sample_content(user):
    """Delete marked starter records while preserving user-created content."""
    profile, _ = Profile.objects.select_for_update().get_or_create(user=user)
    items = Item.objects.filter(owner=user, is_sample=True)
    item_ids = list(items.values_list("id", flat=True))
    sample_item_ids = {str(pk) for pk in item_ids}
    # Remove just the sample item nodes. A sample board may have since gained
    # real items, which stay and keep their placements.
    boards_changed = {}
    sample_board_items = set()
    for board in Board.objects.select_for_update().filter(owner=user, is_sample=True):
        boards_changed[str(board.id)] = board.revision
        sample_board_items.update(
            board.items.filter(is_sample=False).values_list("id", flat=True)
        )
        board.delete()
    for board in Board.objects.select_for_update().filter(owner=user, is_sample=False):
        nodes = board.layout.get("nodes", [])
        kept = [
            node
            for node in nodes
            if node.get("type") != "item" or node.get("item") not in sample_item_ids
        ]
        if len(kept) != len(nodes):
            kept_ids = {node["id"] for node in kept} | {
                group["id"] for group in board.layout.get("groups", [])
            }
            layout = {
                **board.layout,
                "nodes": kept,
                "edges": [
                    edge
                    for edge in board.layout.get("edges", [])
                    if edge["source"] in kept_ids and edge["target"] in kept_ids
                ],
            }
            board.items.remove(*item_ids)
            board.layout = layout
            board.revision += 1
            board.save(update_fields=["layout", "revision", "updated_at"])
            boards_changed[str(board.id)] = board.revision
    items.delete()
    back_to_inbox_if_unplaced(sample_board_items)

    collections = Collection.objects.filter(owner=user, is_sample=True)
    sample_collection_ids = list(collections.values_list("id", flat=True))
    # Move user content out of sample collections before removing them.
    collection_items = CollectionItem.objects.filter(
        collection_id__in=sample_collection_ids, item__is_sample=False
    )
    affected_items = set(collection_items.values_list("item_id", flat=True))
    collection_items.delete()
    collections.delete()
    back_to_inbox_if_unplaced(affected_items)
    profile.sample_content_created_at = None
    profile.save(update_fields=["sample_content_created_at", "updated_at"])
    changed(user.id, items=item_ids, boards=boards_changed)
