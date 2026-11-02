"""
What an assistant can do in BrainBro through MCP. Everything acts as the token's
owner, through the same code the app uses. Reading, capturing, editing notes,
organizing and archiving: nothing deletes.
"""

from collections.abc import Callable
from dataclasses import dataclass, field

from django.db import transaction
from django.db.models import Count, OuterRef, Q, Subquery
from rest_framework import serializers

from apps.boards.layout import migrate_layout
from apps.boards.models import Board
from apps.boards.placing import PlacingError, add_items
from apps.collab.documents import body_written
from apps.history.models import Revision
from apps.items.capture import normalize_url
from apps.items.models import Collection, CollectionItem, Item
from apps.items.notes import sync_images
from apps.items.search import find
from apps.items.serializers import TriageSerializer
from apps.items.titles import note_title
from apps.items.views import capture_text, triage

# How much of a body lists show; `get_item` has all of it.
EXCERPT_LENGTH = 300
MAX_LIMIT = 100
MAX_IDS = 500
# Whole items are long: fewer of them per call than summaries.
MAX_FULL_ITEMS = 50
MAX_REPLACEMENTS = 50

Action = TriageSerializer.Action


class ToolError(ValueError):
    """A failure the assistant can do something about; shown to it as is."""


@dataclass
class Tool:
    name: str
    title: str
    description: str
    # The arguments, checked by `arguments` and described to the client by
    # `schema` (JSON Schema).
    arguments: type[serializers.Serializer]
    schema: dict
    run_with: Callable
    read_only: bool = False
    idempotent: bool = False
    required: list = field(default_factory=list)

    def definition(self):
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": {
                "type": "object",
                "properties": self.schema,
                "required": self.required,
                "additionalProperties": False,
            },
            "annotations": {
                "title": self.title,
                "readOnlyHint": self.read_only,
                "destructiveHint": False,
                "idempotentHint": self.idempotent,
                # Only the user's own BrainBro, nothing outside it.
                "openWorldHint": False,
            },
        }

    def run(self, user, arguments):
        payload = self.arguments(data=arguments)
        if not payload.is_valid():
            raise ToolError(describe(payload.errors))
        return self.run_with(user, payload.validated_data)


def describe(errors):
    """DRF's errors as one line: `ids: This field is required.`."""
    parts = []
    for name, messages in errors.items():
        if isinstance(messages, dict):
            messages = [describe(messages)]
        text = " ".join(str(message) for message in messages)
        parts.append(text if name == "non_field_errors" else f"{name}: {text}")
    return " ".join(parts)


def item_title(item):
    if item.title:
        return item.title
    if item.kind == Item.Kind.NOTE:
        # Named after its body, as the app shows it.
        return note_title(item.body, fallback="")
    return item.metadata.get("title", "")


def item_summary(item):
    summary = {
        "id": item.id,
        "kind": item.kind,
        "status": item.status,
        "title": item_title(item),
        "collections": [
            {"id": collection.id, "name": collection.name}
            for collection in item.collections.all()
        ],
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        # Who made it and through what: "user", or the app's name.
        "created_by": item.created_by or "user",
        "created_via": item.created_via or "unknown",
    }
    if item.edited_at:
        summary["edited_by"] = item.edited_by or "user"
        summary["edited_at"] = item.edited_at
    if item.url:
        summary["url"] = item.url
    if item.body:
        excerpt = item.body[:EXCERPT_LENGTH]
        summary["excerpt"] = excerpt + ("…" if len(item.body) > EXCERPT_LENGTH else "")
    return summary


def item_details(item):
    details = item_summary(item)
    details.pop("excerpt", None)
    details["body"] = item.body
    if item.kind == Item.Kind.NOTE:
        # Sent back to `edit_note`, so it can't overwrite edits made since.
        details["version"] = item.version
    meta = item.metadata
    for key in ("description", "site_name", "author", "filename", "mime", "size"):
        if meta.get(key):
            details[key] = meta[key]
    if item.kind == Item.Kind.ALBUM:
        images = sorted(item.album_items.all(), key=lambda image: image.album_position)
        details["images"] = [item_summary(image) for image in images]
    return details


def owned_items(user):
    return Item.objects.filter(owner=user).prefetch_related("collections")


# What to do about an id that isn't there, said with every "not found".
FIND_ITEMS = "search_items or list_inbox give the ids of existing items."
FIND_COLLECTIONS = "list_collections gives every collection's id."
FIND_BOARDS = "list_boards gives every board's id."


def no_item(ids):
    return ToolError(f"No item with id {', '.join(map(str, ids))}. {FIND_ITEMS}")


def owned_collection(user, collection_id):
    collection = Collection.objects.filter(owner=user, id=collection_id).first()
    if collection is None:
        raise ToolError(f"No collection with id {collection_id}. {FIND_COLLECTIONS}")
    return collection


def owned_collections(user, ids):
    found = list(Collection.objects.filter(owner=user, id__in=ids))
    if len(found) != len(set(ids)):
        missing = ", ".join(map(str, set(ids) - {c.id for c in found}))
        raise ToolError(f"No collection with id {missing}. {FIND_COLLECTIONS}")
    return found


def owned_items_by_id(user, ids):
    """The user's items with these ids; an album's images don't count."""
    items = Item.objects.filter(owner=user, id__in=ids, album__isnull=True)
    found = set(items.values_list("id", flat=True))
    if missing := set(ids) - found:
        raise no_item(missing)
    return items


# Search


class SearchArguments(serializers.Serializer):
    query = serializers.CharField(max_length=500)
    limit = serializers.IntegerField(min_value=1, max_value=MAX_LIMIT, default=20)


def search_items(user, data):
    # Albums' images show up through their album (`get_item`).
    items = owned_items(user).filter(album__isnull=True)
    matches = find(items, data["query"]).order_by("-rank", "-created_at")
    return {"items": [item_summary(item) for item in matches[: data["limit"]]]}


# Get items


class ItemArguments(serializers.Serializer):
    id = serializers.UUIDField()


def get_item(user, data):
    item = (
        owned_items(user)
        .prefetch_related("album_items__collections")
        .filter(id=data["id"])
        .first()
    )
    if item is None:
        raise no_item([data["id"]])
    return item_details(item)


class ItemsArguments(serializers.Serializer):
    ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=MAX_FULL_ITEMS
    )


def get_items(user, data):
    # In the order asked for; ids that aren't the user's are just missing.
    ids = list(dict.fromkeys(data["ids"]))
    found = owned_items(user).prefetch_related("album_items__collections").in_bulk(ids)
    return {
        "items": [item_details(found[item_id]) for item_id in ids if item_id in found],
        "missing": [item_id for item_id in ids if item_id not in found],
    }


# The inbox


class PageArguments(serializers.Serializer):
    limit = serializers.IntegerField(min_value=1, max_value=MAX_LIMIT, default=50)
    offset = serializers.IntegerField(min_value=0, default=0)


def list_inbox(user, data):
    # In the order the app shows: last sorted in (or captured) first.
    items = (
        owned_items(user)
        .filter(status=Item.Status.INBOX, album__isnull=True)
        .order_by("-inbox_rank", "-created_at")
    )
    start, end = data["offset"], data["offset"] + data["limit"]
    return {
        "total": items.count(),
        "items": [item_summary(item) for item in items[start:end]],
    }


# Collections


class NoArguments(serializers.Serializer):
    pass


def collection_summary(collection, item_count):
    return {
        "id": collection.id,
        "name": collection.name,
        "kind": collection.kind,
        "parent": collection.parent_id,
        "item_count": item_count,
    }


def list_collections(user, data):
    # In the order they were sorted by hand, as the app shows.
    collections = (
        Collection.objects.filter(owner=user)
        .annotate(
            item_count=Count("items", filter=Q(items__status=Item.Status.ORGANIZED))
        )
        .order_by("-rank", "name")
    )
    return {
        "collections": [
            collection_summary(collection, collection.item_count)
            for collection in collections
        ]
    }


class CollectionItemsArguments(PageArguments):
    collection_id = serializers.UUIDField()


def list_collection_items(user, data):
    collection = owned_collection(user, data["collection_id"])
    # What is in it now, in the order it was sorted by hand, as the app shows.
    place = CollectionItem.objects.filter(
        item=OuterRef("pk"), collection=collection
    ).values("rank")[:1]
    items = (
        owned_items(user)
        .filter(collections=collection, status=Item.Status.ORGANIZED)
        .annotate(place=Subquery(place))
        .order_by("-place", "-created_at")
    )
    start, end = data["offset"], data["offset"] + data["limit"]
    return {
        "collection": {"id": collection.id, "name": collection.name},
        "total": items.count(),
        "items": [item_summary(item) for item in items[start:end]],
    }


class CreateCollectionArguments(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    kind = serializers.ChoiceField(
        choices=Collection.Kind.choices, default=Collection.Kind.RESOURCE
    )
    parent_id = serializers.UUIDField(required=False, allow_null=True)


def create_collection(user, data):
    parent = None
    if data.get("parent_id"):
        parent = owned_collection(user, data["parent_id"])
    # Names are unique per user, whatever the case.
    clash = Collection.objects.filter(owner=user, name__iexact=data["name"]).first()
    if clash:
        raise ToolError(
            f"A collection named {clash.name!r} exists (id {clash.id}): use it, "
            "or pick another name."
        )
    collection = Collection.objects.create(
        owner=user, name=data["name"], kind=data["kind"], parent=parent
    )
    return collection_summary(collection, 0)


# Capture


class CaptureArguments(serializers.Serializer):
    text = serializers.CharField(max_length=100_000, trim_whitespace=False)
    kind = serializers.ChoiceField(
        choices=[Item.Kind.NOTE, Item.Kind.LINK], required=False
    )
    title = serializers.CharField(max_length=500, required=False, allow_blank=True)
    collection_id = serializers.UUIDField(required=False)

    def validate_text(self, value):
        if not value.strip():
            raise serializers.ValidationError("This field may not be blank.")
        return value


def capture(user, data):
    collection = None
    if "collection_id" in data:
        collection = owned_collection(user, data["collection_id"])
    kind = data.get("kind")
    if kind == Item.Kind.LINK and not normalize_url(data["text"]):
        raise ToolError("text: A link must be one http(s) URL and nothing else.")
    # Without a kind, one URL alone is a link and anything else a note, as
    # when pasting in the app.
    note = Item.Kind.NOTE if kind == Item.Kind.NOTE else None
    item = capture_text(user, data["text"], note, collection)
    if data.get("title"):
        item.title = data["title"]
        item.save(update_fields=["title"])
    return item_details(owned_items(user).get(id=item.id))


# Edit a note


def markdown(**options):
    # Markdown is kept exactly as written.
    return serializers.CharField(max_length=100_000, trim_whitespace=False, **options)


class ReplacementArguments(serializers.Serializer):
    old_text = markdown()
    new_text = markdown(allow_blank=True)


# The ways to change a body short of rewriting it.
PARTIAL_EDITS = ("replace", "prepend", "append")


class EditNoteArguments(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField(max_length=500, required=False, allow_blank=True)
    body = markdown(required=False, allow_blank=True)
    replace = serializers.ListField(
        child=ReplacementArguments(),
        required=False,
        allow_empty=False,
        max_length=MAX_REPLACEMENTS,
    )
    prepend = markdown(required=False)
    append = markdown(required=False)
    version = serializers.CharField(max_length=64, required=False)

    def validate(self, data):
        partial = [name for name in PARTIAL_EDITS if name in data]
        if "title" not in data and "body" not in data and not partial:
            raise serializers.ValidationError(
                "Send a title, a body, or replace, prepend or append."
            )
        if "body" in data and partial:
            raise serializers.ValidationError(
                f"body replaces the whole note: send it alone, or use "
                f"{', '.join(partial)} without it."
            )
        return data


def edit_body(body, data):
    """
    `body` with the partial edits in `data` applied: the replacements in
    order, each on the result of the one before, then prepend and append.
    Raises without changing anything if one replacement doesn't match once.
    """
    for index, change in enumerate(data.get("replace", [])):
        matches = body.count(change["old_text"])
        if matches != 1:
            hint = (
                "Read the note again with get_item and copy the text exactly."
                if matches == 0
                else "Include more of the text around it so it matches once."
            )
            raise ToolError(
                f"replace[{index}]: old_text appears {matches} times in the note, "
                f"it must appear exactly once. {hint} Nothing was saved."
            )
        body = body.replace(change["old_text"], change["new_text"])
    # On a line of their own, not glued to the text next to them.
    if prepend := data.get("prepend"):
        joint = "" if not body or prepend.endswith("\n") else "\n"
        body = prepend + joint + body
    if append := data.get("append"):
        joint = "" if not body or body.endswith("\n") else "\n"
        body = body + joint + append
    return body


@transaction.atomic
def edit_note(user, data):
    item = owned_items(user).select_for_update().filter(id=data["id"]).first()
    if item is None:
        raise no_item([data["id"]])
    if item.kind != Item.Kind.NOTE:
        raise ToolError(
            f"Only notes can be edited, and this item is a {item.kind}. "
            "capture makes a new note."
        )
    if "version" in data and data["version"] != item.version:
        raise ToolError(
            "The note changed since you read it: get it again with get_item "
            "and redo the edit on what it says now. Nothing was saved."
        )
    if any(name in data for name in PARTIAL_EDITS):
        data["body"] = edit_body(item.body, data)
    fields = [name for name in ("title", "body") if name in data]
    if any(data[name] != getattr(item, name) for name in fields):
        item.mark_edited()
        fields += Item.EDIT_FIELDS
    for name in ("title", "body"):
        if name in data:
            setattr(item, name, data[name])
    item.save(update_fields=[*fields, "updated_at"])
    if "body" in data:
        sync_images(item)
        # Open in the app: the edit merges into it live, under its name.
        body_written(item)
    return item_details(owned_items(user).get(id=item.id))


# History


class RevisionsArguments(PageArguments):
    id = serializers.UUIDField()
    limit = serializers.IntegerField(min_value=1, max_value=MAX_LIMIT, default=20)


def revision_summary(revision):
    summary = {
        "id": revision.id,
        "title": revision.title,
        # Who saved it and through what: "user", or the app's name.
        "by": revision.by or "user",
        "via": revision.via or "unknown",
        "started_at": revision.created_at,
        "saved_at": revision.updated_at,
    }
    if revision.restored_from_id:
        summary["restored_from"] = revision.restored_from_id
    return summary


def list_revisions(user, data):
    note = owned_items(user).filter(id=data["id"]).first()
    if note is None:
        raise no_item([data["id"]])
    if note.kind != Item.Kind.NOTE:
        raise ToolError(f"Only notes have revisions, and this item is a {note.kind}.")
    revisions = Revision.objects.filter(item=note).order_by("-created_at")
    start, end = data["offset"], data["offset"] + data["limit"]
    return {
        "total": revisions.count(),
        "revisions": [revision_summary(revision) for revision in revisions[start:end]],
    }


class RevisionArguments(serializers.Serializer):
    revision_id = serializers.UUIDField()


def get_revision(user, data):
    revision = Revision.objects.filter(
        owner=user, id=data["revision_id"], item__isnull=False
    ).first()
    if revision is None:
        raise ToolError(
            f"No revision with id {data['revision_id']}. list_revisions gives "
            "the ids of a note's revisions."
        )
    return {
        **revision_summary(revision),
        "note_id": revision.item_id,
        "body": revision.body,
    }


# Organize and archive


class OrganizeArguments(serializers.Serializer):
    item_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=MAX_IDS
    )
    collection_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=MAX_IDS
    )


def summaries(user, ids):
    return {
        "items": [item_summary(item) for item in owned_items(user).filter(id__in=ids)]
    }


def organize(user, data):
    items = owned_items_by_id(user, data["item_ids"])
    collections = owned_collections(user, data["collection_ids"])
    triage(items, Action.ORGANIZE, collections)
    return summaries(user, data["item_ids"])


class ArchiveArguments(serializers.Serializer):
    item_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=MAX_IDS
    )


def archive(user, data):
    items = owned_items_by_id(user, data["item_ids"])
    triage(items, Action.ARCHIVE)
    return summaries(user, data["item_ids"])


# Boards


def owned_board(user, board_id):
    board = Board.objects.filter(owner=user, id=board_id).first()
    if board is None:
        raise ToolError(f"No board with id {board_id}. {FIND_BOARDS}")
    return board


def list_boards(user, data):
    # In the order the app lists them.
    boards = (
        Board.objects.filter(owner=user)
        .annotate(item_count=Count("items"))
        .order_by("-rank", "-updated_at")
    )
    return {
        "boards": [
            {
                "id": board.id,
                "title": board.title,
                "item_count": board.item_count,
                "updated_at": board.updated_at,
            }
            for board in boards
        ]
    }


class BoardArguments(serializers.Serializer):
    board_id = serializers.UUIDField()


def get_board(user, data):
    """
    What is on a board, without the layout: its items and sticky notes in
    reading order (top to bottom, then left to right) and the groups they
    sit in.
    """
    board = owned_board(user, data["board_id"])
    layout = migrate_layout(board.layout)
    groups = {group["id"]: group for group in layout["groups"]}

    def corner(entry):
        x, y, parent = entry["x"], entry["y"], entry["parent"]
        while parent is not None:
            x, y = x + groups[parent]["x"], y + groups[parent]["y"]
            parent = groups[parent]["parent"]
        return y, x

    nodes = sorted(
        (node for node in layout["nodes"] if node["type"] != "stroke"), key=corner
    )
    items = {str(item.id): item for item in owned_items(user).filter(boards=board)}
    on_board, stickies = [], []
    for node in nodes:
        if node["type"] == "sticky":
            stickies.append({"text": node["text"], "group": node["parent"]})
        elif item := items.get(node["item"]):
            on_board.append({**item_summary(item), "group": node["parent"]})
    return {
        "board": {"id": board.id, "title": board.title},
        "groups": [
            {"id": group["id"], "title": group["title"], "parent": group["parent"]}
            for group in layout["groups"]
        ],
        "items": on_board,
        "stickies": stickies,
    }


class AddToBoardArguments(BoardArguments):
    item_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=MAX_IDS
    )


def add_to_board(user, data):
    board = owned_board(user, data["board_id"])
    ids = list(dict.fromkeys(data["item_ids"]))
    found = owned_items_by_id(user, ids).in_bulk()
    try:
        added = add_items(board, [found[item_id] for item_id in ids])
    except PlacingError as error:
        raise ToolError(str(error)) from None
    return {
        "board": {"id": board.id, "title": board.title},
        "added": added,
        "already_there": [item_id for item_id in ids if item_id not in added],
    }


UUID = {"type": "string", "format": "uuid"}
IDS = {"type": "array", "items": UUID, "minItems": 1, "maxItems": MAX_IDS}
LIMIT = {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT}
OFFSET = {"type": "integer", "minimum": 0}
MARKDOWN = {"type": "string", "description": "Markdown."}

TOOLS = {
    tool.name: tool
    for tool in [
        Tool(
            name="search_items",
            title="Search items",
            description=(
                "Search the user's notes, links, images, recordings and files, "
                "archived ones included, by words and by meaning: items about the same "
                "thing match without sharing a word, in any language. Items "
                "with every word come first; typos are tolerated. Best "
                "matches first, bodies cut short.\n\n"
                "Use it before capture, to find a note to update instead of "
                "saving a duplicate, and whenever the user asks what they "
                "have on a topic. Then get_item or get_items for the whole "
                "text. To see what was captured lately, use list_inbox "
                "instead.\n\n"
                'Example: {"query": "sourdough starter"}'
            ),
            arguments=SearchArguments,
            schema={
                "query": {
                    "type": "string",
                    "description": "Distinctive words, or a short phrase.",
                },
                "limit": LIMIT,
            },
            required=["query"],
            run_with=search_items,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="get_item",
            title="Get an item",
            description=(
                "One item in full: a note's whole Markdown body and its "
                "version, a link's URL and preview, an album's images. Read a "
                "note with it before edit_note, and pass the version along. "
                "For several items at once, use get_items."
            ),
            arguments=ItemArguments,
            schema={"id": UUID},
            required=["id"],
            run_with=get_item,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="get_items",
            title="Get several items",
            description=(
                f"Up to {MAX_FULL_ITEMS} items in full, in one call, in the "
                "order asked for: the same as get_item for each. Ids that "
                "don't exist come back in missing instead of failing the "
                "call. Use it after a search or a listing, to read the "
                "items that look relevant.\n\n"
                'Example: {"ids": ["<id>", "<id>"]}'
            ),
            arguments=ItemsArguments,
            schema={"ids": {**IDS, "maxItems": MAX_FULL_ITEMS}},
            required=["ids"],
            run_with=get_items,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="list_inbox",
            title="List the inbox",
            description=(
                "What is waiting in the inbox to be sorted, newest first, as "
                "the app shows it, with the total. Bodies are cut short. Use "
                "it when the user asks what they captured lately or wants "
                "help sorting it; to find something specific, search_items "
                "is better. Page with limit and offset."
            ),
            arguments=PageArguments,
            schema={"limit": LIMIT, "offset": OFFSET},
            run_with=list_inbox,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="list_collections",
            title="List collections",
            description=(
                "Every collection: its id, name, kind (project, area or "
                "resource), parent collection (null at the top) and how many "
                "items are in it. Check it before create_collection, so you "
                "use a collection that already exists, and before capture or "
                "organize to get the ids."
            ),
            arguments=NoArguments,
            schema={},
            run_with=list_collections,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="list_collection_items",
            title="List a collection's items",
            description=(
                "The items organized in a collection, in the order the user "
                "sorted them, with the total. Bodies are cut short: use "
                "get_items for the whole text. Page with limit and offset."
            ),
            arguments=CollectionItemsArguments,
            schema={"collection_id": UUID, "limit": LIMIT, "offset": OFFSET},
            required=["collection_id"],
            run_with=list_collection_items,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="create_collection",
            title="Create a collection",
            description=(
                "Makes a new, empty collection. Kinds follow PARA: project "
                "(a goal with an end, like a trip), area (an ongoing "
                "responsibility, like health) or resource (a topic of "
                "interest, the default). With parent_id it goes inside "
                "another collection. Only when the user asks for it or "
                "agrees: check list_collections first, names are unique.\n\n"
                'Example: {"name": "Japan trip", "kind": "project"}'
            ),
            arguments=CreateCollectionArguments,
            schema={
                "name": {"type": "string", "maxLength": 120},
                "kind": {"type": "string", "enum": list(Collection.Kind.values)},
                "parent_id": {**UUID, "description": "The collection it goes in."},
            },
            required=["name"],
            run_with=create_collection,
        ),
        Tool(
            name="capture",
            title="Capture a note or link",
            description=(
                "Saves a new note (Markdown) or link into the inbox, or "
                "straight into a collection with collection_id when the user "
                "says where it goes. Without kind, text that is exactly one "
                "URL becomes a link and anything else a note.\n\n"
                "Search first: if a note on the same thing exists, update it "
                "with edit_note instead. Give notes a short title, and say in "
                "the body where the content came from (a URL, or this "
                "conversation).\n\n"
                'Example: {"title": "Pasta dough", "text": "3 eggs, 300 g '
                'flour.\\n\\nFrom a chat with the user."}'
            ),
            arguments=CaptureArguments,
            schema={
                "text": {
                    "type": "string",
                    "description": "The note's Markdown, or the link's URL.",
                },
                "title": {"type": "string", "description": "A short title."},
                "kind": {"type": "string", "enum": ["note", "link"]},
                "collection_id": UUID,
            },
            required=["text"],
            run_with=capture,
        ),
        Tool(
            name="edit_note",
            title="Edit a note",
            description=(
                "Changes a note. Prefer the partial edits, which leave the "
                "rest of the note exactly as it is: replace swaps old_text "
                "for new_text (each old_text must appear exactly once, and "
                "if one doesn't nothing is saved), prepend and append add "
                "text on lines of their own at the start or the end. body "
                "replaces the whole note: only for real rewrites, and not "
                "together with the partial edits. title renames it.\n\n"
                "Pass the version from get_item: if the user edited the note "
                "since, nothing is saved and you should read it again. The "
                "result has the new version, for the next edit.\n\n"
                'Example: {"id": "<id>", "version": "<version>", "replace": '
                '[{"old_text": "- [ ] Book flights", "new_text": "- [x] Book '
                'flights"}], "append": "- [ ] Book the hotel"}'
            ),
            arguments=EditNoteArguments,
            schema={
                "id": UUID,
                "version": {"type": "string"},
                "title": {"type": "string"},
                "replace": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_REPLACEMENTS,
                    "items": {
                        "type": "object",
                        "properties": {
                            "old_text": {"type": "string"},
                            "new_text": {"type": "string"},
                        },
                        "required": ["old_text", "new_text"],
                        "additionalProperties": False,
                    },
                    "description": "Applied in order, all or none.",
                },
                "prepend": MARKDOWN,
                "append": MARKDOWN,
                "body": {**MARKDOWN, "description": "The whole new body."},
            },
            required=["id"],
            run_with=edit_note,
        ),
        Tool(
            name="list_revisions",
            title="List a note's revisions",
            description=(
                "The history of a note, newest first: each revision says who "
                'saved it ("user", or an assistant\'s name), through what, '
                "and when. Saves by the same author a few minutes apart are "
                "one revision; restored_from marks the user bringing back an "
                "older one. The first is what the note holds now. Use it when "
                "the user asks what changed in a note, or who changed it; "
                "get_revision has a revision's whole text. Only the user "
                "restores revisions, in the app. Page with limit and offset."
            ),
            arguments=RevisionsArguments,
            schema={"id": UUID, "limit": LIMIT, "offset": OFFSET},
            required=["id"],
            run_with=list_revisions,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="get_revision",
            title="Get a revision",
            description=(
                "One revision of a note in full: its title and Markdown body "
                "as they were then. Compare it with get_item to see what "
                "changed since."
            ),
            arguments=RevisionArguments,
            schema={"revision_id": UUID},
            required=["revision_id"],
            run_with=get_revision,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="organize",
            title="Organize into collections",
            description=(
                "Adds items to one or more collections and takes them out of "
                "the inbox. Items keep the collections they were already in. "
                "Only when the user asks to sort or file things: what the "
                "assistant captures stays in the inbox otherwise, for the "
                "user to review."
            ),
            arguments=OrganizeArguments,
            schema={"item_ids": IDS, "collection_ids": IDS},
            required=["item_ids", "collection_ids"],
            run_with=organize,
            idempotent=True,
        ),
        Tool(
            name="archive",
            title="Archive items",
            description=(
                "Keeps items but takes them out of the way: out of the inbox "
                "and out of their collections. Nothing is deleted, and search "
                "still finds them. Only when the user asks for it."
            ),
            arguments=ArchiveArguments,
            schema={"item_ids": IDS},
            required=["item_ids"],
            run_with=archive,
            idempotent=True,
        ),
        Tool(
            name="list_boards",
            title="List boards",
            description=(
                "Every board (a canvas where the user lays items out in "
                "space): its id, title and how many items are on it."
            ),
            arguments=NoArguments,
            schema={},
            run_with=list_boards,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="get_board",
            title="Get a board",
            description=(
                "What is on a board, in reading order (top to bottom, left to "
                "right): its items, bodies cut short, its sticky notes, and "
                "the groups they sit in (group is a group's id, or null). "
                "Positions and connections are left out. get_items has the "
                "items' whole text."
            ),
            arguments=BoardArguments,
            schema={"board_id": UUID},
            required=["board_id"],
            run_with=get_board,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="add_to_board",
            title="Add items to a board",
            description=(
                "Puts existing items on a board, where the app puts new "
                "cards: near the middle of the last view, one under the "
                "other, without covering others. Items already there stay "
                "where they are. Items on a board leave the inbox. Only when "
                "the user asks for it.\n\n"
                'Example: {"board_id": "<id>", "item_ids": ["<id>"]}'
            ),
            arguments=AddToBoardArguments,
            schema={"board_id": UUID, "item_ids": IDS},
            required=["board_id", "item_ids"],
            run_with=add_to_board,
            idempotent=True,
        ),
    ]
}
