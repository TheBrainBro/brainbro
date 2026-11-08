import json

import pytest
from django.test import Client

from apps.accounts.models import ApiToken
from apps.boards.models import Board
from apps.items.models import Collection, Item
from apps.public.models import Site
from apps.public.publishing import publish


@pytest.fixture(autouse=True)
def no_previews(monkeypatch):
    # Link previews would go to the network.
    monkeypatch.setattr("apps.items.views.enqueue_preview", lambda item: None)


@pytest.fixture
def key(user):
    return ApiToken.issue(user, "Claude")[1]


@pytest.fixture
def mcp(key):
    client = Client(enforce_csrf_checks=True)

    def send(message, **headers):
        return client.post(
            "/api/mcp/",
            json.dumps(message),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {key}",
            HTTP_ACCEPT="application/json, text/event-stream",
            **headers,
        )

    return send


@pytest.fixture
def call(mcp):
    """Calls a tool; returns its result."""

    def call(tool, /, **arguments):
        response = mcp(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": tool, "arguments": arguments},
            }
        )
        assert response.status_code == 200
        return response.json()["result"]

    return call


def structured(result):
    assert result["isError"] is False, result
    assert json.loads(result["content"][0]["text"]) == result["structuredContent"]
    return result["structuredContent"]


def failure(result):
    assert result["isError"] is True
    return result["content"][0]["text"]


def note(owner, body, **fields):
    return Item.objects.create(owner=owner, kind=Item.Kind.NOTE, body=body, **fields)


# Transport


def test_initialize_agrees_on_the_client_s_version(mcp):
    response = mcp(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "test", "version": "1"},
            },
        }
    )

    result = response.json()["result"]
    assert response.json()["id"] == 1
    assert result["protocolVersion"] == "2025-06-18"
    assert result["capabilities"] == {"tools": {"listChanged": False}}
    assert result["serverInfo"]["name"] == "brainbro"


def test_initialize_offers_the_newest_version_otherwise(mcp):
    response = mcp(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "1999-01-01"},
        }
    )
    assert response.json()["result"]["protocolVersion"] == "2025-11-25"


def test_notifications_are_accepted_without_a_body(mcp):
    response = mcp({"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert response.status_code == 202
    assert response.content == b""


def test_ping(mcp):
    response = mcp({"jsonrpc": "2.0", "id": "a", "method": "ping"})
    assert response.json() == {"jsonrpc": "2.0", "id": "a", "result": {}}


def test_unknown_methods_are_an_error(mcp):
    response = mcp({"jsonrpc": "2.0", "id": 1, "method": "resources/list"})
    assert response.json()["error"]["code"] == -32601


def test_unknown_tools_are_an_error(mcp):
    response = mcp(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "delete_everything", "arguments": {}},
        }
    )
    assert response.json()["error"]["code"] == -32602


def test_malformed_messages_are_refused(mcp, key):
    assert mcp([{"jsonrpc": "2.0", "id": 1, "method": "ping"}]).status_code == 400
    response = Client().post(
        "/api/mcp/",
        "{nope",
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {key}",
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32700


def test_an_unsupported_protocol_version_header_is_refused(mcp):
    response = mcp(
        {"jsonrpc": "2.0", "id": 1, "method": "ping"},
        HTTP_MCP_PROTOCOL_VERSION="1999-01-01",
    )
    assert response.status_code == 400


def test_a_foreign_origin_is_refused(mcp):
    message = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
    assert mcp(message, HTTP_ORIGIN="https://evil.example").status_code == 403
    assert mcp(message, HTTP_ORIGIN="http://testserver").status_code == 200


def test_there_is_no_stream_to_open(key):
    response = Client().get("/api/mcp/", HTTP_AUTHORIZATION=f"Bearer {key}")
    assert response.status_code == 405


@pytest.mark.django_db
def test_it_needs_a_token():
    response = Client().post(
        "/api/mcp/",
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}),
        content_type="application/json",
    )
    assert response.status_code == 401
    # Where "Sign in to BrainBro" starts (see apps.accounts.oauth).
    assert response["WWW-Authenticate"] == (
        'Bearer resource_metadata="http://testserver/.well-known/'
        'oauth-protected-resource/api/mcp", scope="brainbro"'
    )


def test_the_session_is_not_enough(user):
    client = Client()
    client.force_login(user)
    response = client.post(
        "/api/mcp/",
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}),
        content_type="application/json",
    )
    assert response.status_code == 401


def test_tools_are_listed_with_their_schemas(mcp):
    response = mcp({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})

    tools = {tool["name"]: tool for tool in response.json()["result"]["tools"]}
    assert set(tools) == {
        "search_items",
        "get_item",
        "get_items",
        "list_inbox",
        "list_collections",
        "list_collection_items",
        "create_collection",
        "capture",
        "edit_note",
        "list_revisions",
        "get_revision",
        "organize",
        "archive",
        "list_boards",
        "get_board",
        "add_to_board",
        "publish_note",
        "unpublish_note",
        "get_page",
        "update_page",
        "list_blogs",
        "create_blog",
        "update_blog",
        "verify_blog",
    }
    assert tools["capture"]["inputSchema"]["required"] == ["text"]
    assert tools["get_item"]["annotations"]["readOnlyHint"] is True
    assert not any(tool["annotations"]["destructiveHint"] for tool in tools.values())
    # Appending twice adds twice.
    assert tools["edit_note"]["annotations"]["idempotentHint"] is False


def test_the_instructions_say_how_to_use_brain(mcp):
    response = mcp({"jsonrpc": "2.0", "id": 1, "method": "initialize"})

    instructions = response.json()["result"]["instructions"]
    for advice in (
        "Search before capturing",
        "title",
        "partial edits",
        "inbox",
        "do not mention or reveal unrelated items",
        "only when the user asks for it or",
    ):
        assert advice in instructions


def test_search_description_treats_semantic_matches_as_private_candidates(mcp):
    response = mcp({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})

    tools = {tool["name"]: tool for tool in response.json()["result"]["tools"]}
    description = tools["search_items"]["description"]
    assert "loose candidates" in description
    assert "never mention unrelated results" in description


# Reading


def test_search_finds_the_owner_s_items_only(call, user, other_user):
    note(user, "Ideas about gardening")
    note(other_user, "Their gardening notes")

    found = structured(call("search_items", query="gardening"))["items"]

    assert [item["excerpt"] for item in found] == ["Ideas about gardening"]


def test_assistant_search_and_reads_exclude_sample_items(call, user):
    sample = note(user, "Starter gardening notes")
    sample.is_sample = True
    sample.save(update_fields=["is_sample"])

    assert structured(call("search_items", query="gardening"))["items"] == []
    result = call("get_item", id=str(sample.id))
    assert str(sample.id) in failure(result)


def test_assistant_lists_exclude_sample_collections_and_boards(call, user):
    from apps.boards.models import Board

    Collection.objects.create(owner=user, name="Starter collection", is_sample=True)
    Collection.objects.create(owner=user, name="My collection")
    Board.objects.create(owner=user, title="Starter board", is_sample=True)
    Board.objects.create(owner=user, title="My board")

    assert [c["name"] for c in structured(call("list_collections"))["collections"]] == [
        "My collection"
    ]
    assert [b["title"] for b in structured(call("list_boards"))["boards"]] == [
        "My board"
    ]


def test_untitled_notes_are_named_after_their_body(call, user):
    Item.objects.create(owner=user, kind="note", body="Intro\n# Garden plan\nbeds")
    Item.objects.create(owner=user, kind="note", title="Seeds", body="# Garden")

    found = structured(call("search_items", query="garden"))["items"]

    assert sorted(item["title"] for item in found) == ["Garden plan", "Seeds"]


def test_wrong_arguments_come_back_as_a_tool_error(call):
    assert "query" in failure(call("search_items"))


def test_get_item_returns_the_whole_note(call, user):
    item = note(user, "x" * 1000, title="Long")

    details = structured(call("get_item", id=str(item.id)))

    assert details["body"] == "x" * 1000
    # ISO 8601, as DjangoJSONEncoder writes it (milliseconds, UTC as Z).
    assert details["created_at"] == item.created_at.isoformat()[:23] + "Z"
    assert details["version"] == item.version


def test_someone_else_s_item_is_not_found(call, other_user):
    item = note(other_user, "secret")

    message = failure(call("get_item", id=str(item.id)))

    assert "No item" in message
    # And what to do about it.
    assert "search_items" in message


def test_get_several_items_at_once(call, user, other_user):
    first, second = note(user, "first"), note(user, "second")
    theirs = note(other_user, "theirs")
    ids = [str(second.id), str(theirs.id), str(first.id)]

    found = structured(call("get_items", ids=ids))

    assert [item["body"] for item in found["items"]] == ["second", "first"]
    assert found["missing"] == [str(theirs.id)]


def test_list_the_inbox(call, user):
    older, newer = note(user, "older"), note(user, "newer")
    note(user, "sorted", status=Item.Status.ORGANIZED)

    listed = structured(call("list_inbox"))
    page = structured(call("list_inbox", limit=1, offset=1))

    assert [item["excerpt"] for item in listed["items"]] == ["newer", "older"]
    assert listed["total"] == 2
    assert [item["id"] for item in page["items"]] == [str(older.id)]
    assert newer.status == Item.Status.INBOX


def test_collections_and_their_items(call, user, other_user):
    parent = Collection.objects.create(owner=user, name="Work", kind="area")
    child = Collection.objects.create(owner=user, name="Launch", parent=parent)
    Collection.objects.create(owner=other_user, name="Theirs")
    first = note(user, "first", status=Item.Status.ORGANIZED)
    second = note(user, "second", status=Item.Status.ORGANIZED)
    archived = note(user, "archived", status=Item.Status.ARCHIVED)
    child.items.add(first)
    child.items.add(second)
    child.items.add(archived)

    collections = structured(call("list_collections"))["collections"]
    listed = structured(call("list_collection_items", collection_id=str(child.id)))

    assert [(c["name"], c["parent"]) for c in collections] == [
        ("Launch", str(parent.id)),
        ("Work", None),
    ]
    # Last sorted in first, as the app shows it; archived items left it.
    assert [item["excerpt"] for item in listed["items"]] == ["second", "first"]
    assert listed["total"] == 2


def test_create_a_collection(call, user):
    parent = Collection.objects.create(owner=user, name="Travel", kind="area")

    created = structured(
        call(
            "create_collection",
            name="Japan trip",
            kind="project",
            parent_id=str(parent.id),
        )
    )

    collection = Collection.objects.get(owner=user, name="Japan trip")
    assert (collection.kind, collection.parent) == ("project", parent)
    assert created == {
        "id": str(collection.id),
        "name": "Japan trip",
        "kind": "project",
        "parent": str(parent.id),
        "item_count": 0,
    }


def test_a_collection_name_is_used_once(call, user):
    existing = Collection.objects.create(owner=user, name="Reading")

    message = failure(call("create_collection", name="reading"))

    assert str(existing.id) in message
    assert Collection.objects.count() == 1


def test_a_collection_can_t_go_in_someone_else_s(call, other_user):
    theirs = Collection.objects.create(owner=other_user, name="Theirs")

    result = call("create_collection", name="Mine", parent_id=str(theirs.id))

    assert "list_collections" in failure(result)


# Writing


def test_capture_a_note(call, user):
    created = structured(call("capture", text="# Plan\n\nsteps", kind="note"))

    item = Item.objects.get(owner=user)
    assert (item.kind, item.status, item.body) == ("note", "inbox", "# Plan\n\nsteps")
    assert created["id"] == str(item.id)


def test_capture_a_link_into_a_collection(call, user):
    collection = Collection.objects.create(owner=user, name="Reading")

    call("capture", text="https://example.com/a", collection_id=str(collection.id))

    item = Item.objects.get(owner=user)
    assert (item.kind, item.url, item.status) == (
        "link",
        "https://example.com/a",
        "organized",
    )
    assert list(item.collections.all()) == [collection]


def test_capture_a_note_with_a_title(call, user):
    created = structured(call("capture", text="3 eggs", title="Pasta dough"))

    assert Item.objects.get(owner=user).title == "Pasta dough"
    assert created["title"] == "Pasta dough"


def test_a_url_can_be_kept_as_a_note(call, user):
    call("capture", text="https://example.com", kind="note")
    assert Item.objects.get(owner=user).kind == Item.Kind.NOTE


def test_a_link_must_be_a_url(call, user):
    assert "URL" in failure(call("capture", text="not a url", kind="link"))
    assert not Item.objects.exists()


def test_capture_into_someone_else_s_collection_fails(call, other_user):
    theirs = Collection.objects.create(owner=other_user, name="Theirs")

    result = call("capture", text="hi", collection_id=str(theirs.id))

    assert "No collection" in failure(result)
    assert not Item.objects.exists()


def test_edit_a_note(call, user):
    item = note(user, "old", title="Old")

    edited = structured(
        call("edit_note", id=str(item.id), body="new\n", version=item.version)
    )

    item.refresh_from_db()
    assert (item.title, item.body) == ("Old", "new\n")
    assert edited["version"] == item.version


def test_an_edit_on_a_stale_version_is_refused(call, user):
    item = note(user, "old")
    stale = item.version
    item.body = "edited in the app"
    item.save()

    result = call("edit_note", id=str(item.id), body="mine", version=stale)

    assert "changed since" in failure(result)
    item.refresh_from_db()
    assert item.body == "edited in the app"


def test_append_and_prepend(call, user):
    item = note(user, "- one")

    edited = structured(
        call("edit_note", id=str(item.id), prepend="# List", append="- two")
    )

    item.refresh_from_db()
    assert item.body == "# List\n- one\n- two"
    assert edited["version"] == item.version


def test_append_to_an_empty_note(call, user):
    item = note(user, "")
    call("edit_note", id=str(item.id), append="first")
    item.refresh_from_db()
    assert item.body == "first"


def test_replace_parts_of_a_note(call, user):
    item = note(user, "- [ ] flights\n- [ ] hotel\n")

    call(
        "edit_note",
        id=str(item.id),
        version=item.version,
        replace=[
            {"old_text": "- [ ] flights", "new_text": "- [x] flights"},
            {"old_text": "- [ ] hotel", "new_text": "- [x] hotel"},
        ],
    )

    item.refresh_from_db()
    assert item.body == "- [x] flights\n- [x] hotel\n"


def test_replacements_are_all_or_none(call, user):
    item = note(user, "a b a")

    missing = failure(
        call(
            "edit_note",
            id=str(item.id),
            replace=[
                {"old_text": "b", "new_text": "c"},
                {"old_text": "zzz", "new_text": "y"},
            ],
        )
    )
    twice = failure(
        call("edit_note", id=str(item.id), replace=[{"old_text": "a", "new_text": "x"}])
    )

    assert "replace[1]: old_text appears 0 times" in missing
    assert "appears 2 times" in twice
    item.refresh_from_db()
    assert item.body == "a b a"


def test_a_whole_body_goes_alone(call, user):
    item = note(user, "old")

    message = failure(call("edit_note", id=str(item.id), body="new", append="more"))

    assert "body replaces the whole note" in message
    item.refresh_from_db()
    assert item.body == "old"


def test_only_notes_are_edited(call, user):
    link = Item.objects.create(owner=user, kind=Item.Kind.LINK, url="https://a.b")
    assert "Only notes" in failure(call("edit_note", id=str(link.id), title="x"))


def test_organize_and_archive(call, user):
    collection = Collection.objects.create(owner=user, name="Ideas")
    first, second = note(user, "one"), note(user, "two")
    ids = [str(first.id), str(second.id)]

    call("organize", item_ids=ids, collection_ids=[str(collection.id)])

    assert set(collection.items.values_list("status", flat=True)) == {"organized"}
    assert collection.items.count() == 2

    archived = structured(call("archive", item_ids=[str(first.id)]))["items"]

    first.refresh_from_db()
    assert first.status == Item.Status.ARCHIVED
    assert archived[0]["collections"] == []


def test_someone_else_s_items_are_left_alone(call, user, other_user):
    theirs = note(other_user, "theirs")

    assert "No item" in failure(call("archive", item_ids=[str(theirs.id)]))

    theirs.refresh_from_db()
    assert theirs.status == Item.Status.INBOX


def test_what_an_assistant_writes_is_marked_as_its(call, user):
    created = structured(call("capture", text="An idea", kind="note"))
    assert (created["created_by"], created["created_via"]) == ("Claude", "mcp")
    assert "edited_by" not in created

    mine = note(user, "Mine")
    edited = structured(call("edit_note", id=str(mine.id), append="More"))

    assert (edited["created_by"], edited["created_via"]) == ("user", "unknown")
    assert edited["edited_by"] == "Claude"
    mine.refresh_from_db()
    assert (mine.edited_by, mine.edited_via) == ("Claude", "mcp")


def test_an_edit_that_changes_nothing_is_not_one(call, user):
    mine = note(user, "Mine")

    edited = structured(call("edit_note", id=str(mine.id), body="Mine"))

    assert "edited_by" not in edited


# History


def test_list_a_notes_revisions(call, user, other_user):
    item = note(user, "mine")
    call("edit_note", id=str(item.id), append="Claude's line")
    note(other_user, "theirs")

    result = structured(call("list_revisions", id=str(item.id)))

    assert result["total"] == 2
    [claude, mine] = result["revisions"]
    assert (claude["by"], claude["via"]) == ("Claude", "mcp")
    assert (mine["by"], mine["via"]) == ("user", "unknown")
    assert "body" not in claude


def test_get_a_revision(call, user):
    item = note(user, "first")
    call("edit_note", id=str(item.id), body="second")
    first = structured(call("list_revisions", id=str(item.id)))["revisions"][-1]

    revision = structured(call("get_revision", revision_id=first["id"]))

    assert (revision["body"], revision["note_id"]) == ("first", str(item.id))


def test_revisions_are_of_your_notes(call, user, other_user):
    theirs = note(other_user, "theirs")
    link = Item.objects.create(owner=user, kind=Item.Kind.LINK, url="https://x.org")
    board = Board.objects.create(owner=user, title="Ideas")

    assert "No item" in failure(call("list_revisions", id=str(theirs.id)))
    assert "Only notes" in failure(call("list_revisions", id=str(link.id)))
    revision = theirs.revisions.get()
    assert "No revision" in failure(call("get_revision", revision_id=str(revision.id)))
    board_revision = board.revisions.get()
    result = call("get_revision", revision_id=str(board_revision.id))
    assert "No revision" in failure(result)


# Boards


def item_node(node_id, item, x, y, parent=None):
    return {
        "id": node_id,
        "type": "item",
        "item": str(item.id),
        "x": x,
        "y": y,
        "w": 280,
        "h": None,
        "parent": parent,
    }


def test_list_boards(call, user, other_user):
    board = Board.objects.create(owner=user, title="Ideas")
    board.items.add(note(user, "on it"))
    Board.objects.create(owner=other_user, title="Theirs")

    boards = structured(call("list_boards"))["boards"]

    assert [(b["title"], b["item_count"]) for b in boards] == [("Ideas", 1)]


def test_get_a_board_without_its_layout(call, user):
    lower, upper, framed = note(user, "lower"), note(user, "upper"), note(user, "in")
    board = Board.objects.create(owner=user, title="Plan")
    board.layout = {
        **board.layout,
        "groups": [
            {
                "id": "g",
                "x": 1000,
                "y": 0,
                "w": 400,
                "h": 400,
                "parent": None,
                "title": "Later",
                "color": "",
            }
        ],
        "nodes": [
            item_node("a", lower, 0, 500),
            item_node("b", upper, 0, 0),
            item_node("c", framed, 10, 200, parent="g"),
            {
                "id": "s",
                "type": "sticky",
                "x": 0,
                "y": 300,
                "w": None,
                "h": None,
                "parent": None,
                "text": "Remember",
                "color": "",
            },
        ],
    }
    board.save()
    board.items.set([lower, upper, framed])

    seen = structured(call("get_board", board_id=str(board.id)))

    assert [(i["excerpt"], i["group"]) for i in seen["items"]] == [
        ("upper", None),
        ("in", "g"),
        ("lower", None),
    ]
    assert seen["groups"] == [{"id": "g", "title": "Later", "parent": None}]
    assert seen["stickies"] == [{"text": "Remember", "group": None}]
    assert "layout" not in seen


def test_add_items_to_a_board(call, user):
    there, first, second = note(user, "there"), note(user, "first"), note(user, "2")
    board = Board.objects.create(owner=user, title="Plan")
    board.layout = {**board.layout, "nodes": [item_node("a", there, 500, 100)]}
    board.save()
    board.items.add(there)
    revision = board.revision
    ids = [str(first.id), str(there.id), str(second.id)]

    result = structured(call("add_to_board", board_id=str(board.id), item_ids=ids))

    assert result["added"] == [str(first.id), str(second.id)]
    assert result["already_there"] == [str(there.id)]
    board.refresh_from_db()
    assert board.revision == revision + 1
    assert set(board.items.all()) == {there, first, second}
    nodes = {node["item"]: node for node in board.layout["nodes"]}
    # Where it was, and the new ones apart from each other and from it.
    assert (nodes[str(there.id)]["x"], nodes[str(there.id)]["y"]) == (500, 100)
    corners = {(node["x"], node["y"]) for node in nodes.values()}
    assert len(corners) == 3
    first.refresh_from_db()
    assert first.status == Item.Status.ORGANIZED


def test_add_to_someone_else_s_board(call, user, other_user):
    theirs = Board.objects.create(owner=other_user, title="Theirs")
    item = note(user, "mine")

    result = call("add_to_board", board_id=str(theirs.id), item_ids=[str(item.id)])

    assert "list_boards" in failure(result)


# Publishing


def test_items_say_whether_a_note_is_public_and_where(call, user):
    private = note(user, "Draft")
    public = publish(note(user, "Trip plan", title="Trip plan"))

    found = structured(call("get_items", ids=[str(private.id), str(public.id)]))
    draft, trip = found["items"]

    assert draft["published_at"] is None
    assert "public_url" not in draft
    assert trip["published_at"] is not None
    assert trip["public_url"].startswith("http://testserver/@")
    assert trip["public_url"].endswith("/trip-plan")
    search = structured(call("search_items", query="Trip plan"))["items"][0]
    assert search["public_url"] == trip["public_url"]


def test_publish_a_note(call, user):
    item = note(user, "Trip plan", title="Trip plan")

    result = structured(call("publish_note", id=str(item.id)))

    item.refresh_from_db()
    assert item.published_at is not None
    assert result["slug"] == "trip-plan"
    assert result["public_url"].endswith("/trip-plan")


def test_publish_a_note_at_a_slug(call, user):
    item = note(user, "Trip plan")

    result = structured(call("publish_note", id=str(item.id), slug="japan"))

    assert result["slug"] == "japan"
    assert result["public_url"].endswith("/japan")


def test_a_slug_is_used_once_and_must_be_one(call, user):
    publish(note(user, "Other"), "japan")
    item = note(user, "Trip plan")

    assert "already has this address" in failure(
        call("publish_note", id=str(item.id), slug="japan")
    )
    assert "lowercase letters" in failure(
        call("publish_note", id=str(item.id), slug="Not a slug")
    )
    item.refresh_from_db()
    assert item.published_at is None


def test_only_notes_are_published(call, user):
    link = Item.objects.create(owner=user, kind=Item.Kind.LINK, url="https://a.com")

    assert "Only notes" in failure(call("publish_note", id=str(link.id)))


def test_someone_else_s_note_is_not_published(call, other_user):
    item = note(other_user, "Theirs")

    assert "No item" in failure(call("publish_note", id=str(item.id)))
    item.refresh_from_db()
    assert item.published_at is None


def test_unpublish_a_note(call, user):
    item = publish(note(user, "Trip plan"), "japan")

    result = structured(call("unpublish_note", id=str(item.id)))

    item.refresh_from_db()
    assert item.published_at is None
    assert item.public_slug == "japan"
    assert result["public_url"] is None


def test_publishing_says_it_makes_notes_public(mcp):
    response = mcp({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})

    tools = {tool["name"]: tool for tool in response.json()["result"]["tools"]}
    assert "anyone" in tools["publish_note"]["description"]
    assert "never on your own" in tools["publish_note"]["description"]


# Page settings


def test_get_a_page(call, user):
    item = publish(note(user, "# Trip plan\nTen days in Japan."), "japan")

    page = structured(call("get_page", id=str(item.id)))

    assert page["slug"] == "japan"
    assert page["address"].startswith("http://testserver/@")
    assert page["address"].endswith("/")
    assert page["title"] == ""
    assert page["defaults"]["title"] == "Trip plan"
    assert page["preview"] == {
        "title": "Trip plan",
        "description": page["defaults"]["description"],
    }


def test_a_note_never_published_has_no_page(call, user):
    item = note(user, "Draft")

    assert "publish_note first" in failure(call("get_page", id=str(item.id)))
    assert "publish_note first" in failure(
        call("update_page", id=str(item.id), title="Draft")
    )


def test_update_a_page(call, user):
    item = publish(note(user, "Trip plan"), "japan")

    page = structured(
        call(
            "update_page",
            id=str(item.id),
            slug="japan-2026",
            title="Japan",
            description="Ten days.",
        )
    )

    item.refresh_from_db()
    assert item.public_slug == "japan-2026"
    assert item.public_title == "Japan"
    assert page["preview"]["description"] == "Ten days."
    assert page["public_url"].endswith("/japan-2026")


def test_a_page_update_needs_something_to_change(call, user):
    item = publish(note(user, "Trip plan"))

    assert "Send a slug" in failure(call("update_page", id=str(item.id)))


def test_a_page_can_t_take_another_note_s_slug(call, user):
    publish(note(user, "Other"), "japan")
    item = publish(note(user, "Trip plan"), "trip")

    assert "already has this address" in failure(
        call("update_page", id=str(item.id), slug="japan")
    )


# Blogs

BLOG = "blog.example.com"


@pytest.fixture
def dns(monkeypatch):
    """The TXT records public DNS answers with, by name."""
    records = {}
    monkeypatch.setattr(
        "apps.public.tasks.txt_values", lambda name: set(records.get(name, []))
    )
    return records


def test_list_blogs(call, user, other_user):
    writing = Collection.objects.create(owner=user, name="Writing")
    Collection.objects.create(owner=user, name="Travel", parent=writing)
    site = Site.objects.create(owner=user, hostname=BLOG, collection=writing)
    Site.objects.create(owner=other_user, hostname="theirs.example.com")

    blogs = structured(call("list_blogs"))["blogs"]

    assert len(blogs) == 1
    blog = blogs[0]
    assert blog["id"] == str(site.id)
    assert blog["domain"] == BLOG
    assert blog["url"] == f"https://{BLOG}/"
    assert blog["status"] == "unverified"
    assert blog["collection"] == {"id": str(writing.id), "name": "Writing"}
    assert blog["name"] == "Writing"
    assert blog["categories"][0]["name"] == "Travel"
    assert blog["categories"][0]["url"] == f"https://{BLOG}/c/travel"
    assert {"type": "CNAME", "name": BLOG, "value": "testserver"} in blog["records"]
    assert {
        "type": "TXT",
        "name": f"_brainbro.{BLOG}",
        "value": f"brainbro-site-verification={site.token}",
    } in blog["records"]


def test_create_a_blog(call, user):
    writing = Collection.objects.create(owner=user, name="Writing")

    blog = structured(
        call(
            "create_blog",
            domain="Blog.Example.com",
            collection_id=str(writing.id),
            title="Field notes",
            links=[{"name": "GitHub", "url": "https://github.com/someone"}],
            powered_by=False,
        )
    )

    site = Site.objects.get()
    assert site.owner == user
    assert site.hostname == BLOG
    assert site.collection == writing
    assert site.powered_by is False
    assert site.links == [{"name": "GitHub", "url": "https://github.com/someone"}]
    assert blog["status"] == "unverified"
    assert blog["name"] == "Field notes"


def test_a_blog_is_checked_as_in_the_app(call, user, other_user):
    Site.objects.create(owner=other_user, hostname=BLOG, status=Site.Status.VERIFIED)

    assert "domain: Another blog" in failure(call("create_blog", domain=BLOG))
    assert "domain: Enter a domain" in failure(call("create_blog", domain="nope"))
    assert "url" in failure(
        call(
            "create_blog",
            domain="other.example.com",
            links=[{"name": "Bad", "url": "javascript:alert(1)"}],
        )
    )
    assert not Site.objects.filter(owner=user).exists()


def test_a_blog_can_t_show_someone_else_s_collection(call, user, other_user):
    theirs = Collection.objects.create(owner=other_user, name="Theirs")

    assert "No collection" in failure(
        call("create_blog", domain=BLOG, collection_id=str(theirs.id))
    )
    assert not Site.objects.exists()


def test_update_a_blog(call, user):
    site = Site.objects.create(
        owner=user, hostname=BLOG, status=Site.Status.VERIFIED, title="Old"
    )

    blog = structured(call("update_blog", id=str(site.id), description="Notes."))

    site.refresh_from_db()
    assert site.description == "Notes."
    assert site.title == "Old"
    assert site.status == Site.Status.VERIFIED
    assert blog["description"] == "Notes."


def test_a_new_domain_has_to_be_verified_again(call, user):
    site = Site.objects.create(owner=user, hostname=BLOG, status=Site.Status.VERIFIED)

    blog = structured(call("update_blog", id=str(site.id), domain="new.example.com"))

    assert blog["domain"] == "new.example.com"
    assert blog["status"] == "unverified"


def test_someone_else_s_blog_is_out_of_reach(call, other_user, dns):
    site = Site.objects.create(owner=other_user, hostname=BLOG)

    assert "No blog" in failure(call("update_blog", id=str(site.id), title="Mine"))
    assert "No blog" in failure(call("verify_blog", id=str(site.id)))
    site.refresh_from_db()
    assert site.title == ""
    assert site.status == Site.Status.UNVERIFIED


def test_verify_a_blog(call, user, dns):
    site = Site.objects.create(owner=user, hostname=BLOG)
    dns[f"_brainbro.{BLOG}"] = [f"brainbro-site-verification={site.token}"]

    # The worker runs at once in tests.
    blog = structured(call("verify_blog", id=str(site.id)))

    assert blog["status"] == "verified"
    assert blog["verified_at"] is not None


def test_a_blog_without_its_record_fails_to_verify(call, user, dns):
    site = Site.objects.create(owner=user, hostname=BLOG)

    assert structured(call("verify_blog", id=str(site.id)))["status"] == "failed"


def test_a_note_on_a_blog_lives_there(call, user):
    writing = Collection.objects.create(owner=user, name="Writing")
    Site.objects.create(
        owner=user, hostname=BLOG, collection=writing, status=Site.Status.VERIFIED
    )
    item = note(user, "Trip plan")
    item.collections.add(writing)

    result = structured(call("publish_note", id=str(item.id), slug="trip"))

    assert result["public_url"] == f"https://{BLOG}/trip"


def test_no_tool_deletes_a_blog(mcp):
    response = mcp({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})

    names = {tool["name"] for tool in response.json()["result"]["tools"]}
    assert not any("delete" in name or "remove" in name for name in names)
