"""
What an assistant can do in Brain through MCP. Everything acts as the token's
owner, through the same code the app uses. Reading, capturing, editing notes,
organizing and archiving: nothing deletes.
"""

from collections.abc import Callable
from dataclasses import dataclass, field

from django.db.models import Count, OuterRef, Q, Subquery
from rest_framework import serializers

from apps.items.capture import normalize_url
from apps.items.models import Collection, CollectionItem, Item
from apps.items.search import find
from apps.items.serializers import TriageSerializer
from apps.items.views import capture_text, sync_images, triage

# How much of a body lists show; `get_item` has all of it.
EXCERPT_LENGTH = 300
MAX_LIMIT = 100
MAX_IDS = 500

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
                # Only the user's own Brain, nothing outside it.
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


def item_summary(item):
    summary = {
        "id": item.id,
        "kind": item.kind,
        "status": item.status,
        "title": item.title or item.metadata.get("title", ""),
        "collections": [
            {"id": collection.id, "name": collection.name}
            for collection in item.collections.all()
        ],
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }
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


def owned_collection(user, collection_id):
    collection = Collection.objects.filter(owner=user, id=collection_id).first()
    if collection is None:
        raise ToolError(f"No collection with id {collection_id}.")
    return collection


def owned_collections(user, ids):
    found = list(Collection.objects.filter(owner=user, id__in=ids))
    if len(found) != len(set(ids)):
        missing = set(ids) - {collection.id for collection in found}
        raise ToolError(f"No collection with id {', '.join(map(str, missing))}.")
    return found


def owned_items_by_id(user, ids):
    """The user's items with these ids; an album's images don't count."""
    items = Item.objects.filter(owner=user, id__in=ids, album__isnull=True)
    found = set(items.values_list("id", flat=True))
    if missing := set(ids) - found:
        raise ToolError(f"No item with id {', '.join(map(str, missing))}.")
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


# Get an item


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
        raise ToolError(f"No item with id {data['id']}.")
    return item_details(item)


# Collections


class NoArguments(serializers.Serializer):
    pass


def list_collections(user, data):
    collections = (
        Collection.objects.filter(owner=user)
        .annotate(
            item_count=Count("items", filter=Q(items__status=Item.Status.ORGANIZED))
        )
        .order_by("name")
    )
    return {
        "collections": [
            {
                "id": collection.id,
                "name": collection.name,
                "kind": collection.kind,
                "parent": collection.parent_id,
                "item_count": collection.item_count,
            }
            for collection in collections
        ]
    }


class CollectionItemsArguments(serializers.Serializer):
    collection_id = serializers.UUIDField()
    limit = serializers.IntegerField(min_value=1, max_value=MAX_LIMIT, default=50)
    offset = serializers.IntegerField(min_value=0, default=0)


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


# Capture


class CaptureArguments(serializers.Serializer):
    text = serializers.CharField(max_length=100_000, trim_whitespace=False)
    kind = serializers.ChoiceField(
        choices=[Item.Kind.NOTE, Item.Kind.LINK], required=False
    )
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
    return item_details(owned_items(user).get(id=item.id))


# Edit a note


class EditNoteArguments(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField(max_length=500, required=False, allow_blank=True)
    # Markdown is kept exactly as written.
    body = serializers.CharField(
        max_length=100_000, required=False, allow_blank=True, trim_whitespace=False
    )
    version = serializers.CharField(max_length=64, required=False)

    def validate(self, data):
        if "title" not in data and "body" not in data:
            raise serializers.ValidationError("Send a title, a body or both.")
        return data


def edit_note(user, data):
    item = owned_items(user).filter(id=data["id"]).first()
    if item is None:
        raise ToolError(f"No item with id {data['id']}.")
    if item.kind != Item.Kind.NOTE:
        raise ToolError("Only notes can be edited.")
    if "version" in data and data["version"] != item.version:
        raise ToolError(
            "The note changed since you read it: get it again and redo the edit."
        )
    fields = [name for name in ("title", "body") if name in data]
    for name in fields:
        setattr(item, name, data[name])
    item.save(update_fields=[*fields, "updated_at"])
    if "body" in data:
        sync_images(item)
    return item_details(owned_items(user).get(id=item.id))


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


UUID = {"type": "string", "format": "uuid"}
IDS = {"type": "array", "items": UUID, "minItems": 1, "maxItems": MAX_IDS}

TOOLS = {
    tool.name: tool
    for tool in [
        Tool(
            name="search_items",
            title="Search items",
            description=(
                "Full-text search over the user's notes, links, images and "
                "files, archived ones included. Every word must match; typos "
                "are tolerated. Best matches first, bodies cut short: use "
                "get_item for the whole item."
            ),
            arguments=SearchArguments,
            schema={
                "query": {"type": "string", "description": "Words to look for."},
                "limit": {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT},
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
                "version (for edit_note), a link's URL and preview, an album's "
                "images."
            ),
            arguments=ItemArguments,
            schema={"id": UUID},
            required=["id"],
            run_with=get_item,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="list_collections",
            title="List collections",
            description=(
                "Every collection: its id, name, kind (project, area or "
                "resource), parent collection (null at the top) and how many "
                "items are in it."
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
                "sorted them. Bodies are cut short: use get_item for the "
                "whole item."
            ),
            arguments=CollectionItemsArguments,
            schema={
                "collection_id": UUID,
                "limit": {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT},
                "offset": {"type": "integer", "minimum": 0},
            },
            required=["collection_id"],
            run_with=list_collection_items,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="capture",
            title="Capture a note or link",
            description=(
                "Saves a new note (Markdown) or link into the inbox, or "
                "straight into a collection with collection_id. Without kind, "
                "text that is exactly one URL becomes a link and anything "
                "else a note."
            ),
            arguments=CaptureArguments,
            schema={
                "text": {
                    "type": "string",
                    "description": "The note's Markdown, or the link's URL.",
                },
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
                "Replaces a note's title, body (Markdown) or both. Pass the "
                "version from get_item: if the user edited the note since, "
                "nothing is saved and you should read it again."
            ),
            arguments=EditNoteArguments,
            schema={
                "id": UUID,
                "title": {"type": "string"},
                "body": {"type": "string", "description": "The whole new body."},
                "version": {"type": "string"},
            },
            required=["id"],
            run_with=edit_note,
            idempotent=True,
        ),
        Tool(
            name="organize",
            title="Organize into collections",
            description=(
                "Adds items to one or more collections and takes them out of "
                "the inbox. Items keep the collections they were already in."
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
                "and out of their collections. Nothing is deleted."
            ),
            arguments=ArchiveArguments,
            schema={"item_ids": IDS},
            required=["item_ids"],
            run_with=archive,
            idempotent=True,
        ),
    ]
}
