"""The small, explicitly marked starter shared by every new BrainBro account."""

from io import BytesIO

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from PIL import Image, ImageDraw

from apps.boards.layout import empty_layout
from apps.boards.models import Board
from apps.boards.views import back_to_inbox_if_unplaced
from apps.events.changes import changed
from apps.items.models import Collection, CollectionItem, Item, rank_now
from apps.items.uploads import make_thumbnail

from .models import Profile


def _starter_illustration():
    """A colorful, legible capture-to-collections diagram for the image demo."""
    image = Image.new("RGB", (1200, 720), "#171521")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (28, 28, 1172, 692), 32, fill="#201c30", outline="#39334d", width=3
    )

    # Inbox card
    draw.rounded_rectangle(
        (82, 142, 470, 578), 24, fill="#29243a", outline="#51466f", width=3
    )
    draw.ellipse((116, 178, 146, 208), fill="#a78bfa")
    draw.rounded_rectangle((164, 182, 330, 198), 8, fill="#ded6f7")
    for y, color, line_width in (
        (250, "#f0abfc", 244),
        (350, "#93c5fd", 204),
        (450, "#86efac", 264),
    ):
        draw.rounded_rectangle((112, y, 440, y + 82), 14, fill="#342e47")
        draw.rounded_rectangle((132, y + 19, 148, y + 35), 6, fill=color)
        draw.rounded_rectangle(
            (166, y + 20, 166 + line_width, y + 31), 6, fill="#ddd8e9"
        )
        draw.rounded_rectangle((132, y + 51, 350, y + 60), 5, fill="#858095")

    # A clear path from the inbox to organized collections.
    draw.line((510, 360, 638, 360), fill="#a78bfa", width=12)
    draw.polygon([(638, 338), (680, 360), (638, 382)], fill="#a78bfa")
    draw.ellipse((548, 340, 588, 380), fill="#201c30", outline="#c4b5fd", width=5)

    # Three distinct collection cards.
    cards = (
        (720, 142, "#c4b5fd", 250),
        (720, 286, "#93c5fd", 205),
        (720, 430, "#86efac", 280),
    )
    for x, y, color, line_width in cards:
        draw.rounded_rectangle(
            (x, y, 1084, y + 110), 20, fill="#29243a", outline="#51466f", width=2
        )
        draw.rounded_rectangle((x + 24, y + 26, x + 66, y + 68), 12, fill=color)
        draw.rounded_rectangle(
            (x + 90, y + 29, x + 90 + line_width, y + 43), 7, fill="#e7e1f2"
        )
        draw.rounded_rectangle((x + 90, y + 59, x + 280, y + 69), 5, fill="#858095")

    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


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
            "Projects have a clear outcome and an end. Examples: plan a trip, "
            "prepare a talk, or launch a product. Keep the notes, links, and "
            "next steps that help you finish it together. When it is done, "
            "move it to Archives.",
        ),
        (
            "Areas",
            Collection.Kind.AREA,
            "Areas are parts of life you look after over time, with no finish "
            "line: health, home, finances, or a team. Keep the routines, "
            "standards, and useful details you want to return to.",
        ),
        (
            "Resources",
            Collection.Kind.RESOURCE,
            "Save useful ideas and references that are not for a current "
            "project yet: recipes, research, places to visit, or things to "
            "learn. When one becomes something you will act on, start a "
            "project and bring the best notes along.",
        ),
        (
            "Archives",
            Collection.Kind.RESOURCE,
            "Keep finished projects and inactive areas here, so useful history "
            "stays close. Archived material remains available when you need "
            "it; move an item back into an active collection anytime.",
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
        title="Start here: your second brain",
        body=(
            "BrainBro is a private, self-hosted place for the things you want "
            "to remember. Capture a thought, link, image, or voice note in "
            "your inbox; you do not have to decide where it belongs right "
            "away.\n\n"
            "When you are ready, organize useful items into collections. "
            "Use Projects for outcomes you will finish, Areas for ongoing "
            "responsibilities, Resources for ideas to revisit, and Archives "
            "for work you have finished.\n\n"
            "Browse the same knowledge as a list, arrange related notes on a "
            "board, or explore connections in the graph. You can also connect "
            "an AI assistant to search and update your notes with your "
            "permission.\n\n"
            "Try it: move this note into Projects, add a next step, then "
            "archive it when you are done."
        ),
        is_sample=True,
    )
    link = Item.objects.create(
        owner=user,
        kind=Item.Kind.LINK,
        url="https://github.com/TheBrainBro/brainbro/blob/main/docs/mcp.md",
        title="How BrainBro works with AI",
        metadata={
            "title": "How BrainBro works with AI",
            "description": (
                "Learn how assistants can search and update your notes with MCP."
            ),
        },
        is_sample=True,
    )
    picture = Item(
        owner=user,
        kind=Item.Kind.IMAGE,
        title="From a quick capture to a clear plan",
        body=(
            "Capture first, organize when you are ready, and find your notes "
            "when you need them."
        ),
        metadata={"filename": "brainbro-inbox-to-collections.png", "mime": "image/png"},
        is_sample=True,
    )
    image_data = _starter_illustration()
    with Image.open(BytesIO(image_data)) as illustration:
        width, height = illustration.size
    picture.metadata = {
        **picture.metadata,
        "size": len(image_data),
        "width": width,
        "height": height,
    }
    picture.file.save(
        "brainbro-inbox-to-collections.png",
        ContentFile(image_data),
        save=True,
    )
    if thumbnail := make_thumbnail(picture):
        picture.preview_image.save(
            "brainbro-inbox-to-collections.webp", ContentFile(thumbnail), save=False
        )
        picture.preview_status = Item.PreviewStatus.READY
        picture.metadata = {
            **picture.metadata,
            "size": len(image_data),
            "width": width,
            "height": height,
        }
        picture.save(
            update_fields=["preview_image", "preview_status", "metadata", "updated_at"]
        )
    else:
        raise ValueError("The starter illustration must have a thumbnail.")
    Item.objects.create(
        owner=user,
        kind=Item.Kind.NOTE,
        title="Connect your AI",
        body=(
            "Add BrainBro as an MCP connector in your AI assistant, then sign "
            "in and allow access. "
            "Copy the ready-to-paste prompt from Settings → AI assistants.\n\n"
            "BrainBro is my private second brain for notes, links, images, "
            "and plans. I want you to use it as shared memory with my other "
            "AI assistants. Help me connect you to it.\n\n"
            "1. Read how BrainBro works with assistants: https://github.com/TheBrainBro/brainbro/blob/main/docs/mcp.md\n"
            f"2. Its MCP server is {mcp_url}.\n"
            "3. Walk me through signing in and allowing access.\n"
            "4. Once connected, list my inbox to check it works.\n\n"
            "Once connected, search BrainBro before answering questions "
            "about my notes or plans. Save things only when I ask you to "
            "remember them, and read a note before editing it."
        ),
        is_sample=True,
    )
    # They remain clearly visible in the inbox while the collections are ready to try.
    board = Board.objects.create(
        owner=user,
        title="From capture to clarity",
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
                    "id": "sample-image",
                    "type": "item",
                    "item": str(picture.id),
                    "x": 720,
                    "y": 0,
                    "w": 360.0,
                    "h": None,
                    "parent": None,
                },
                {
                    "id": "sample-capture-tip",
                    "type": "sticky",
                    "text": (
                        "Capture anything in your inbox. Decide where it belongs later."
                    ),
                    "x": 0,
                    "y": 360,
                    "w": 320.0,
                    "h": 160.0,
                    "parent": None,
                    "color": "#f5d0fe",
                },
                {
                    "id": "sample-organize-tip",
                    "type": "sticky",
                    "text": (
                        "Use collections to keep projects, responsibilities, and "
                        "useful references together. Boards help you arrange and "
                        "connect related ideas."
                    ),
                    "x": 370,
                    "y": 360,
                    "w": 420.0,
                    "h": 200.0,
                    "parent": None,
                    "color": "#bfdbfe",
                },
            ],
        },
    )
    board.items.add(note, link, picture)
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
