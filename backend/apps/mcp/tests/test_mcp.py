import json

import pytest
from django.test import Client

from apps.accounts.models import ApiToken
from apps.boards.models import Board
from apps.items.models import Collection, Item


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
    assert result["serverInfo"]["name"] == "brain"


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
    # Where "Sign in to Brain" starts (see apps.accounts.oauth).
    assert response["WWW-Authenticate"] == (
        'Bearer resource_metadata="http://testserver/.well-known/'
        'oauth-protected-resource/api/mcp", scope="brain"'
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
    }
    assert tools["capture"]["inputSchema"]["required"] == ["text"]
    assert tools["get_item"]["annotations"]["readOnlyHint"] is True
    assert not any(tool["annotations"]["destructiveHint"] for tool in tools.values())
    # Appending twice adds twice.
    assert tools["edit_note"]["annotations"]["idempotentHint"] is False


def test_the_instructions_say_how_to_use_brain(mcp):
    response = mcp({"jsonrpc": "2.0", "id": 1, "method": "initialize"})

    instructions = response.json()["result"]["instructions"]
    for advice in ("Search before capturing", "title", "partial edits", "inbox"):
        assert advice in instructions


# Reading


def test_search_finds_the_owner_s_items_only(call, user, other_user):
    note(user, "Ideas about gardening")
    note(other_user, "Their gardening notes")

    found = structured(call("search_items", query="gardening"))["items"]

    assert [item["excerpt"] for item in found] == ["Ideas about gardening"]


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
