"""
What an assistant can do in BrainBro through MCP. Everything acts as the token's
owner, through the same code the app uses. Reading, capturing, editing notes,
organizing, archiving, publishing notes and setting up blogs: nothing deletes.
"""

import posixpath
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Count, F, OuterRef, Q, Subquery
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.models import Permission
from apps.accounts.quota import QuotaExceeded, check_room
from apps.boards.layout import migrate_layout
from apps.boards.models import Board
from apps.boards.placing import PlacingError, add_items
from apps.collab.documents import body_written
from apps.history.models import Revision
from apps.items.capture import normalize_url
from apps.items.models import Collection, CollectionItem, Item, NoteImage
from apps.items.note_images import MAX_PASTED_SIZE, UNUSED_GRACE
from apps.items.notes import sync_images
from apps.items.safe_http import FetchError, TransientFetchError, fetch
from apps.items.search import find
from apps.items.serializers import TriageSerializer
from apps.items.tasks import make_note_image_display
from apps.items.titles import note_title
from apps.items.uploads import UploadTooLarge, inspect_upload
from apps.items.views import PageSerializer, capture_text, page_settings, triage
from apps.public.models import Redirect, Site
from apps.public.publishing import (
    NotPublished,
    SlugTaken,
    is_valid_slug,
    publish,
    save_page,
    unpublish,
)
from apps.public.redirects import InvalidRedirect, save_redirects
from apps.public.sites import (
    filed_notes,
    public_url,
    public_urls,
    site_categories,
    site_url,
)
from apps.public.tasks import verify_site
from apps.public.views import SiteSerializer

# How much of a body lists show; `get_item` has all of it.
EXCERPT_LENGTH = 300
MAX_LIMIT = 100
MAX_IDS = 500
# Whole items are long: fewer of them per call than summaries.
MAX_FULL_ITEMS = 50
MAX_REPLACEMENTS = 50
MAX_REDIRECTS = 200

Action = TriageSerializer.Action

# The request the tools run in: for whole addresses, and the app's own checks.
current_request = ContextVar("mcp_request")


@contextmanager
def serving(request):
    token = current_request.set(request)
    try:
        yield
    finally:
        current_request.reset(token)


def absolute(url):
    """`/@ana/trip` on this server as `https://<host>/@ana/trip`; a blog's as is."""
    return current_request.get().build_absolute_uri(url)


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
    permission: Permission
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
    if item.kind == Item.Kind.NOTE:
        # Null while private; published, where anyone reads it.
        summary["published_at"] = item.published_at
        if item.published_at:
            summary["public_url"] = absolute(public_url(item))
            summary["listed"] = item.public_listed
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
    return Item.objects.filter(owner=user, is_sample=False).prefetch_related(
        "collections"
    )


# What to do about an id that isn't there, said with every "not found".
FIND_ITEMS = "search_items or list_inbox give the ids of existing items."
FIND_COLLECTIONS = "list_collections gives every collection's id."
FIND_BOARDS = "list_boards gives every board's id."


def no_item(ids):
    return ToolError(f"No item with id {', '.join(map(str, ids))}. {FIND_ITEMS}")


def owned_collection(user, collection_id):
    collection = Collection.objects.filter(
        owner=user, id=collection_id, is_sample=False
    ).first()
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
        Collection.objects.filter(owner=user, is_sample=False)
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
    # Names are unique side by side, whatever the case.
    clash = Collection.objects.filter(
        owner=user, parent=parent, name__iexact=data["name"]
    ).first()
    if clash:
        raise ToolError(
            f"A collection named {clash.name!r} exists there (id {clash.id}): "
            "use it, or pick another name."
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
        # Named after its text if untitled, as `get_item` names the note.
        "title": revision.title or note_title(revision.body, fallback=""),
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
    board = Board.objects.filter(owner=user, id=board_id, is_sample=False).first()
    if board is None:
        raise ToolError(f"No board with id {board_id}. {FIND_BOARDS}")
    return board


def list_boards(user, data):
    # In the order the app lists them.
    boards = (
        Board.objects.filter(owner=user, is_sample=False)
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


# Publishing


def owned_note(user, note_id):
    note = owned_items(user).filter(id=note_id).first()
    if note is None:
        raise no_item([note_id])
    if note.kind != Item.Kind.NOTE:
        raise ToolError(f"Only notes can be published, and this item is a {note.kind}.")
    return note


def publication(note):
    return {
        "id": note.id,
        "title": item_title(note),
        "slug": note.public_slug,
        "published_at": note.published_at,
        "public_url": absolute(public_url(note)) if note.published_at else None,
        "listed": note.public_listed,
    }


SLUG_RULE = "Use lowercase letters, numbers and hyphens."
SLUG_TAKEN = (
    "slug: Another of the user's notes already has this address: pick another. "
    "Nothing was saved."
)


def published_date(**options):
    return serializers.DateTimeField(
        required=False, validators=[not_in_the_future], **options
    )


def not_in_the_future(value):
    if value > timezone.now():
        raise serializers.ValidationError(
            "It can't be in the future: a published note is public at once."
        )


class PublishArguments(serializers.Serializer):
    id = serializers.UUIDField()
    slug = serializers.CharField(max_length=80, required=False)
    published_at = published_date()
    listed = serializers.BooleanField(required=False)

    def validate_slug(self, value):
        if not is_valid_slug(value):
            raise serializers.ValidationError(SLUG_RULE)
        return value


def publish_note(user, data):
    note = owned_note(user, data["id"])
    try:
        publish(note, data.get("slug"), data.get("published_at"), data.get("listed"))
    except SlugTaken:
        raise ToolError(SLUG_TAKEN) from None
    return publication(note)


def unpublish_note(user, data):
    return publication(unpublish(owned_note(user, data["id"])))


def page(note):
    settings = page_settings(note)
    # Its image is in the app, behind the user's sign-in: no use to an assistant.
    settings["preview"].pop("image_url")
    return {
        **publication(note),
        **settings,
        "address": absolute(settings["address"]),
    }


def note_with_page(user, note_id):
    note = owned_note(user, note_id)
    if not note.public_slug:
        raise ToolError(
            "This note was never published, so it has no page yet: publish_note "
            "first, when the user asks for it."
        )
    return note


def get_page(user, data):
    return page(note_with_page(user, data["id"]))


class UpdatePageArguments(PageSerializer):
    id = serializers.UUIDField()
    published_at = published_date()
    listed = serializers.BooleanField(required=False)

    def validate(self, data):
        if not set(data) - {"id"}:
            raise serializers.ValidationError(
                "Send a slug, a title, a description, an image, published_at or listed."
            )
        return data


def update_page(user, data):
    note = note_with_page(user, data.pop("id"))
    try:
        save_page(note, data)
    except SlugTaken:
        raise ToolError(SLUG_TAKEN) from None
    except NotPublished:
        raise ToolError(
            "published_at: This note is private now, and its date is when it "
            "went public: publish_note takes published_at, when the user asks "
            "to publish it. Nothing was saved."
        ) from None
    return page(note)


# Blogs

FIND_BLOGS = "list_blogs gives every blog's id."
# The app's names for what the tools call otherwise.
BLOG_FIELDS = {"domain": "hostname", "collection_id": "collection"}


def blog_details(site):
    details = SiteSerializer(site, context={"request": current_request.get()}).data
    collection = site.collection
    return {
        "id": details["id"],
        "domain": details["hostname"],
        "url": details["url"],
        "status": details["status"],
        "collection": (
            {"id": collection.id, "name": collection.name} if collection else None
        ),
        "title": details["title"],
        "name": site.name,
        "description": details["description"],
        "author": details["author"],
        "author_url": details["author_url"],
        "show_author": details["show_author"],
        "links": details["links"],
        "powered_by": details["powered_by"],
        "categories": [
            {
                "name": category.name,
                "collection_id": category.collection_id,
                "url": site_url(site, f"/c/{category.slug}"),
            }
            for category in site_categories(site)
        ],
        "records": details["records"],
        "pending_domain": details["pending_hostname"] or None,
        "pending_status": (
            details["pending_status"] if details["pending_hostname"] else None
        ),
        "checked_at": details["checked_at"],
        "verified_at": details["verified_at"],
        "created_at": details["created_at"],
    }


def owned_sites(user):
    return Site.objects.filter(owner=user).select_related("collection")


def owned_site(user, site_id):
    site = owned_sites(user).filter(id=site_id).first()
    if site is None:
        raise ToolError(f"No blog with id {site_id}. {FIND_BLOGS}")
    return site


def list_blogs(user, data):
    return {"blogs": [blog_details(site) for site in owned_sites(user)]}


class LinkArguments(serializers.Serializer):
    name = serializers.CharField()
    url = serializers.CharField()


class BlogArguments(serializers.Serializer):
    domain = serializers.CharField(max_length=253)
    collection_id = serializers.UUIDField(required=False, allow_null=True)
    title = serializers.CharField(required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)
    author = serializers.CharField(required=False, allow_blank=True)
    author_url = serializers.CharField(required=False, allow_blank=True)
    show_author = serializers.BooleanField(required=False)
    links = serializers.ListField(child=LinkArguments(), required=False)
    powered_by = serializers.BooleanField(required=False)


def save_blog(user, data, site=None):
    """Through the app's own checks: the domain, the collection, the links."""
    if data.get("collection_id"):
        owned_collection(user, data["collection_id"])
    fields = {BLOG_FIELDS.get(name, name): value for name, value in data.items()}
    payload = SiteSerializer(
        site,
        data=fields,
        partial=site is not None,
        context={"request": current_request.get()},
    )
    if not payload.is_valid():
        names = {field: name for name, field in BLOG_FIELDS.items()}
        errors = {
            names.get(name, name): value for name, value in payload.errors.items()
        }
        raise ToolError(f"{describe(errors)} Nothing was saved.")
    return blog_details(payload.save(owner=user))


def create_blog(user, data):
    return save_blog(user, data)


class UpdateBlogArguments(BlogArguments):
    id = serializers.UUIDField()
    domain = serializers.CharField(max_length=253, required=False)

    def validate(self, data):
        if not set(data) - {"id"}:
            raise serializers.ValidationError("Send at least one setting to change.")
        return data


def update_blog(user, data):
    site = owned_site(user, data.pop("id"))
    return save_blog(user, data, site)


class BlogIdArguments(serializers.Serializer):
    id = serializers.UUIDField()


def verify_blog(user, data):
    # As the app does: the lookup runs in the worker, and the blog says how it went.
    site = owned_site(user, data["id"])
    site.start_check()
    verify_site.delay(str(site.id))
    return blog_details(owned_site(user, site.id))


class BlogPostsArguments(PageArguments):
    id = serializers.UUIDField()


def blog_posts(site):
    """Its notes, published first (newest first), then its drafts."""
    return (
        filed_notes(site)
        .filter(is_sample=False)
        .order_by(F("published_at").desc(nulls_last=True), "-created_at")
    )


def list_blog_posts(user, data):
    site = owned_site(user, data["id"])
    posts = blog_posts(site)
    start, end = data["offset"], data["offset"] + data["limit"]
    page_of = list(posts[start:end])
    public = [post for post in page_of if post.published_at]
    readable = {
        note_id: absolute(url) for note_id, url in public_urls(public).items() if url
    }
    return {
        "blog": {"id": site.id, "domain": site.hostname, "status": site.status},
        "total": posts.count(),
        "posts": [
            {
                "id": post.id,
                "title": item_title(post),
                "slug": post.public_slug or None,
                "status": "published" if post.published_at else "draft",
                "listed": post.public_listed,
                "published_at": post.published_at,
                # On the blog's domain, once it is verified and serving.
                "url": (
                    site_url(site, f"/{post.public_slug}")
                    if post.published_at
                    else None
                ),
                # Where anyone reads it now.
                "public_url": readable.get(post.id),
                "created_at": post.created_at,
                "updated_at": post.updated_at,
            }
            for post in page_of
        ],
    }


# Redirects


class RedirectPairArguments(serializers.Serializer):
    from_path = serializers.CharField(max_length=2048)
    to = serializers.CharField(max_length=2048)


class SetRedirectsArguments(serializers.Serializer):
    id = serializers.UUIDField()
    redirects = serializers.ListField(
        child=RedirectPairArguments(), allow_empty=False, max_length=MAX_REDIRECTS
    )


def redirect_summary(redirect):
    return {
        "from_path": redirect.path,
        "to": redirect.target,
        "updated_at": redirect.updated_at,
    }


def set_redirects(user, data):
    site = owned_site(user, data["id"])
    pairs = [(pair["from_path"], pair["to"]) for pair in data["redirects"]]
    try:
        saved = save_redirects(site, pairs)
    except InvalidRedirect as invalid:
        raise ToolError(f"{invalid} Nothing was saved.") from None
    return {
        "blog": {"id": site.id, "domain": site.hostname, "status": site.status},
        "redirects": [redirect_summary(redirect) for redirect in saved],
    }


class ListRedirectsArguments(PageArguments):
    id = serializers.UUIDField()


def list_redirects(user, data):
    site = owned_site(user, data["id"])
    redirects = Redirect.objects.filter(site=site)
    start, end = data["offset"], data["offset"] + data["limit"]
    return {
        "blog": {"id": site.id, "domain": site.hostname, "status": site.status},
        "total": redirects.count(),
        "redirects": [redirect_summary(r) for r in redirects[start:end]],
    }


# Images


class ImportImageArguments(serializers.Serializer):
    url = serializers.URLField(max_length=2048)

    def validate_url(self, value):
        if urlsplit(value).scheme not in ("http", "https"):
            raise serializers.ValidationError("Use an http(s) URL.")
        return value


def imported_image(image):
    return {
        "id": image.id,
        "src": image.src,
        "markdown": f"![]({image.src})",
        "source_url": image.metadata.get("source_url"),
        "width": image.metadata.get("width"),
        "height": image.metadata.get("height"),
        "size": image.metadata.get("size"),
    }


def import_image(user, data):
    url = data["url"]
    # Asked twice (a retry): the copy no note uses yet, or one let go.
    known = (
        NoteImage.objects.filter(
            Q(note__isnull=True) | Q(unused_since__isnull=False),
            owner=user,
            source=NoteImage.Source.PASTED,
            metadata__source_url=url,
        )
        .order_by("-created_at")
        .first()
    )
    if known:
        return imported_image(known)
    try:
        fetched = fetch(url, max_bytes=MAX_PASTED_SIZE, accept="image/*")
    except TransientFetchError:
        raise ToolError(
            f"{url} didn't answer, or is busy: try again in a while. Nothing was saved."
        ) from None
    except FetchError as failed:
        raise ToolError(
            f"Couldn't download {url}: {failed}. Nothing was saved."
        ) from None
    name = posixpath.basename(urlsplit(fetched.url).path) or "image"
    file = ContentFile(fetched.content, name=name)
    limit = MAX_PASTED_SIZE // (1024 * 1024)
    try:
        upload = inspect_upload(file)
    except UploadTooLarge:
        raise ToolError(f"The image is over {limit} MB. Nothing was saved.") from None
    if upload.kind != Item.Kind.IMAGE:
        raise ToolError(
            f"{url} isn't an image BrainBro can show (JPEG, PNG, GIF, WebP, AVIF "
            f"or HEIC): it is {upload.mime}. Nothing was saved."
        )
    try:
        check_room(user, file.size)
    except QuotaExceeded as exc:
        raise ToolError(f"{exc} Nothing was saved.") from None
    # As one pasted into a note: unused until a note links it.
    image = NoteImage(
        owner=user,
        source=NoteImage.Source.PASTED,
        metadata={**upload.metadata, "source_url": url},
        unused_since=timezone.now(),
    )
    image.src = f"attachments/{image.id}.{upload.extension}"
    image.original.save(f"original.{upload.extension}", file, save=False)
    image.save()
    transaction.on_commit(lambda: make_note_image_display.delay(str(image.id)))
    return imported_image(image)


UUID = {"type": "string", "format": "uuid"}
IDS = {"type": "array", "items": UUID, "minItems": 1, "maxItems": MAX_IDS}
LIMIT = {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT}
OFFSET = {"type": "integer", "minimum": 0}
MARKDOWN = {"type": "string", "description": "Markdown."}
LISTED = {
    "type": "boolean",
    "description": (
        "false makes it unlisted: anyone with its address can read it, but it "
        "shows on no list, feed or sitemap and search engines don't index it. "
        "true lists it. Without it, it stays as it was."
    ),
}
PUBLISHED_AT = {
    "type": "string",
    "format": "date-time",
    "description": (
        "The date its page shows and its blog sorts by, ISO 8601 (like "
        "2021-05-03T10:00:00Z), not in the future. For a post moved from "
        "elsewhere, the date it was first published there."
    ),
}
LINKS = {
    "type": "array",
    "maxItems": 10,
    "items": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "maxLength": 60},
            "url": {"type": "string", "format": "uri"},
        },
        "required": ["name", "url"],
        "additionalProperties": False,
    },
    "description": "Shown on its index, under the description. Replaces them all.",
}

TOOLS = {
    tool.name: tool
    for tool in [
        Tool(
            name="search_items",
            permission=Permission.READ,
            title="Search items",
            description=(
                "Search the user's notes, links, images, recordings and files, "
                "archived ones included, by words and by meaning: items about the same "
                "thing match without sharing a word, in any language. Items "
                "with every word come first; typos are tolerated. Best "
                "matches first, bodies cut short. Semantic search can return "
                "loose candidates: use only results relevant to the user's "
                "request, and never mention unrelated results.\n\n"
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
            permission=Permission.READ,
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
            permission=Permission.READ,
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
            permission=Permission.READ,
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
            permission=Permission.READ,
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
            permission=Permission.READ,
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
            permission=Permission.EDIT,
            title="Create a collection",
            description=(
                "Makes a new, empty collection. Kinds follow PARA: project "
                "(a goal with an end, like a trip), area (an ongoing "
                "responsibility, like health) or resource (a topic of "
                "interest, the default). With parent_id it goes inside "
                "another collection. Only when the user asks for it or "
                "agrees: check list_collections first, and reuse one that "
                "already covers it. Names are unique within a parent.\n\n"
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
            permission=Permission.CAPTURE,
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
            permission=Permission.EDIT,
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
            permission=Permission.READ,
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
            permission=Permission.READ,
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
            permission=Permission.EDIT,
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
            permission=Permission.EDIT,
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
            permission=Permission.READ,
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
            permission=Permission.READ,
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
            permission=Permission.EDIT,
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
        Tool(
            name="publish_note",
            permission=Permission.PUBLISH,
            title="Publish a note",
            description=(
                "Makes a note public: anyone with its address can read it, "
                "signed in or not, and so can search engines. Only when the "
                "user asks for it or agrees to it, never on your own. It "
                "lives on the user's page on this server, or on their blog "
                "if it is filed in a blog's collection (see list_blogs). "
                "slug is the end of its address; without one it keeps the "
                "one it had, or gets one made from its title. published_at "
                "is the date it shows: give a post moved from another blog "
                "its original date; without one it keeps the date it had, "
                "or gets now. listed false keeps it off its blog, feeds and "
                "search engines. Returns public_url, its address.\n\n"
                'Example: {"id": "<id>", "slug": "trip-plan", "published_at": '
                '"2021-05-03T10:00:00Z"}'
            ),
            arguments=PublishArguments,
            schema={
                "id": UUID,
                "slug": {
                    "type": "string",
                    "maxLength": 80,
                    "description": "Lowercase letters, numbers and hyphens.",
                },
                "published_at": PUBLISHED_AT,
                "listed": LISTED,
            },
            required=["id"],
            run_with=publish_note,
            idempotent=True,
        ),
        Tool(
            name="unpublish_note",
            permission=Permission.PUBLISH,
            title="Unpublish a note",
            description=(
                "Makes a public note private again: its address stops "
                "working at once. It keeps its slug and page settings for "
                "when it is published again. Only when the user asks for it."
            ),
            arguments=ItemArguments,
            schema={"id": UUID},
            required=["id"],
            run_with=unpublish_note,
            idempotent=True,
        ),
        Tool(
            name="get_page",
            permission=Permission.READ,
            title="Get a note's page settings",
            description=(
                "A published note's page settings, as Page settings in the "
                "app: its slug and address, and the title, description and "
                "image its page shows in search results and shared links. "
                "Empty ones use the defaults listed; preview is what shows "
                'now. image is the src of one of the note\'s images, "none" '
                "for no image, or empty for its first."
            ),
            arguments=ItemArguments,
            schema={"id": UUID},
            required=["id"],
            run_with=get_page,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="update_page",
            permission=Permission.PUBLISH,
            title="Update a note's page settings",
            description=(
                "Changes some of a published note's page settings; an empty "
                "title, description or image goes back to its default. A new "
                "slug changes its address, and links to the old one stop "
                "working (on a blog, set_redirects can keep them). "
                "published_at changes the date it shows, and where its blog "
                "lists it. listed false takes it off its blog, feeds and "
                "search engines, at the same address. Only when the user "
                "asks for it.\n\n"
                'Example: {"id": "<id>", "description": "What we packed for '
                'ten days in Japan."}'
            ),
            arguments=UpdatePageArguments,
            schema={
                "id": UUID,
                "slug": {"type": "string", "maxLength": 80},
                "title": {"type": "string", "maxLength": 200},
                "description": {"type": "string", "maxLength": 300},
                "image": {
                    "type": "string",
                    "description": 'An image\'s src in the note, "none", or "".',
                },
                "published_at": PUBLISHED_AT,
                "listed": LISTED,
            },
            required=["id"],
            run_with=update_page,
            idempotent=True,
        ),
        Tool(
            name="list_blogs",
            permission=Permission.READ,
            title="List blogs",
            description=(
                "The user's blogs on their own domains: each one's domain, "
                "address, status, the collection whose published notes it "
                "shows, its title, description, links and categories (the "
                "collections right inside its own; create_collection with "
                "parent_id adds one). records are the DNS records the user "
                "adds at their domain provider. status: unverified (records "
                "not checked yet), checking, failed (the TXT record wasn't "
                "found) or verified (serving). pending_domain is the domain "
                "a serving blog is moving to, if any: records are that "
                "domain's, and pending_status says how its check went."
            ),
            arguments=NoArguments,
            schema={},
            run_with=list_blogs,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="create_blog",
            permission=Permission.PUBLISH,
            title="Create a blog",
            description=(
                "Sets up a blog on a domain the user owns, showing the "
                "published notes filed in collection_id and the collections "
                "inside it. Only when the user asks for it. It serves "
                "nothing until verified: tell the user to add the records "
                "in the result at their domain provider, then verify_blog. "
                "Without a title it is named after its collection.\n\n"
                'Example: {"domain": "blog.example.com", "collection_id": '
                '"<id>", "title": "Field notes"}'
            ),
            arguments=BlogArguments,
            schema={
                "domain": {"type": "string", "description": "Like blog.example.com."},
                "collection_id": UUID,
                "title": {"type": "string", "maxLength": 120},
                "description": {"type": "string", "maxLength": 300},
                "author": {
                    "type": "string",
                    "maxLength": 80,
                    "description": "Who signs it. Empty: the user's display name.",
                },
                "author_url": {
                    "type": "string",
                    "maxLength": 500,
                    "description": "The author's website, for search engines.",
                },
                "show_author": {
                    "type": "boolean",
                    "description": "The author under its name, on by default.",
                },
                "links": LINKS,
                "powered_by": {
                    "type": "boolean",
                    "description": "A small Powered by BrainBro line, on by default.",
                },
            },
            required=["domain"],
            run_with=create_blog,
        ),
        Tool(
            name="update_blog",
            permission=Permission.PUBLISH,
            title="Update a blog",
            description=(
                "Changes some of a blog's settings: the same ones as "
                "create_blog. links replaces all of them. A verified blog's "
                "new domain stays pending and the blog keeps serving at its "
                "current one: tell the user to add the records in the result, "
                "then verify_blog moves it. Sending its current domain calls "
                "the move off. Only when the user asks for it. Blogs are "
                "turned off or removed in the app only."
            ),
            arguments=UpdateBlogArguments,
            schema={
                "id": UUID,
                "domain": {"type": "string"},
                "collection_id": {**UUID, "type": ["string", "null"]},
                "title": {"type": "string", "maxLength": 120},
                "description": {"type": "string", "maxLength": 300},
                "author": {"type": "string", "maxLength": 80},
                "author_url": {"type": "string", "maxLength": 500},
                "show_author": {"type": "boolean"},
                "links": LINKS,
                "powered_by": {"type": "boolean"},
            },
            required=["id"],
            run_with=update_blog,
            idempotent=True,
        ),
        Tool(
            name="verify_blog",
            permission=Permission.PUBLISH,
            title="Verify a blog's domain",
            description=(
                "Looks up the blog's TXT record, once the user says they "
                "added its records. verified: it is serving at its url. "
                "failed: the record wasn't found; DNS changes can take a "
                "while to show, so the user can try again later. checking: "
                "the lookup is still running, call list_blogs in a few "
                "seconds to see how it went. A blog already serving stays "
                "verified during the lookup, and stops only if DNS answers "
                "that its record is gone. On a blog moving to a new "
                "domain it checks that one and says so in pending_status; "
                "found, the blog moves there, and until then nothing changes "
                "where it serves."
            ),
            arguments=BlogIdArguments,
            schema={"id": UUID},
            required=["id"],
            run_with=verify_blog,
            idempotent=True,
        ),
        Tool(
            name="list_blog_posts",
            permission=Permission.READ,
            title="List a blog's posts",
            description=(
                "The notes on a blog: those filed in its collection or the "
                "collections inside it, published ones first (newest first), "
                "then drafts (filed there but private). Each has its id, "
                "title, slug, status (published or draft), published_at, url "
                "(its address on the blog's domain, once the blog is "
                "verified) and public_url (where anyone reads it now). Use it "
                "to check what is on a blog, and before moving posts in, so "
                "none is added twice. Page with limit and offset."
            ),
            arguments=BlogPostsArguments,
            schema={"id": UUID, "limit": LIMIT, "offset": OFFSET},
            required=["id"],
            run_with=list_blog_posts,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="set_redirects",
            permission=Permission.PUBLISH,
            title="Set a blog's redirects",
            description=(
                "Sends readers of old addresses on a blog's domain to new "
                "ones, for good (HTTP 301), which also tells search engines "
                "a post moved. For posts moved from another blog on the same "
                "domain whose address changed: keeping the old slug needs no "
                "redirect. from_path is the old path (/old-post; a whole URL "
                "is read as its path, without the query); to is a path on "
                "the blog (/new-post) or an http(s) URL. A from_path already "
                "there gets the new to. All or none: one wrong pair saves "
                "nothing. They work once the blog is verified and serving. A "
                "published post's address, the blog's index, /c/ categories, "
                "/rss and /api can't redirect. Only when the user asks for "
                f"it. Up to {MAX_REDIRECTS} per call.\n\n"
                'Example: {"id": "<blog id>", "redirects": [{"from_path": '
                '"/mi-viaje", "to": "/viaje-a-viena"}]}'
            ),
            arguments=SetRedirectsArguments,
            schema={
                "id": UUID,
                "redirects": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_REDIRECTS,
                    "items": {
                        "type": "object",
                        "properties": {
                            "from_path": {"type": "string", "maxLength": 2048},
                            "to": {"type": "string", "maxLength": 2048},
                        },
                        "required": ["from_path", "to"],
                        "additionalProperties": False,
                    },
                },
            },
            required=["id", "redirects"],
            run_with=set_redirects,
            idempotent=True,
        ),
        Tool(
            name="list_redirects",
            permission=Permission.READ,
            title="List a blog's redirects",
            description=(
                "A blog's redirects, by old path: where each one sends "
                "readers. Page with limit and offset."
            ),
            arguments=ListRedirectsArguments,
            schema={"id": UUID, "limit": LIMIT, "offset": OFFSET},
            required=["id"],
            run_with=list_redirects,
            read_only=True,
            idempotent=True,
        ),
        Tool(
            name="import_image",
            permission=Permission.CAPTURE,
            title="Import an image from a URL",
            description=(
                "Downloads an image into BrainBro, as if the user had pasted "
                "it into a note, so a note no longer depends on the site it "
                "came from (when moving posts from another blog, say). "
                "Returns src, its address in BrainBro: put it in a note's "
                "Markdown in place of the old URL, as in markdown "
                "(![alt](attachments/<id>.jpg)), with capture or edit_note. "
                "A note has to link it within "
                f"{UNUSED_GRACE.days} days, or it is deleted. The same URL "
                "asked again gives the same image while no note uses it. "
                "JPEG, PNG, GIF, WebP, AVIF or HEIC, up to "
                f"{MAX_PASTED_SIZE // (1024 * 1024)} MB.\n\n"
                'Example: {"url": "https://example.com/photo.jpg"}'
            ),
            arguments=ImportImageArguments,
            schema={"url": {"type": "string", "format": "uri"}},
            required=["url"],
            run_with=import_image,
        ),
    ]
}
