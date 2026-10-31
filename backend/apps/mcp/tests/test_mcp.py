import json

import pytest
from django.test import Client

from apps.accounts.models import ApiToken
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

    def call(name, **arguments):
        response = mcp(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
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
    assert response["WWW-Authenticate"] == "Bearer"


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
        "list_collections",
        "list_collection_items",
        "capture",
        "edit_note",
        "organize",
        "archive",
    }
    assert tools["capture"]["inputSchema"]["required"] == ["text"]
    assert tools["get_item"]["annotations"]["readOnlyHint"] is True
    assert not any(tool["annotations"]["destructiveHint"] for tool in tools.values())


# Reading


def test_search_finds_the_owner_s_items_only(call, user, other_user):
    note(user, "Ideas about gardening")
    note(other_user, "Their gardening notes")

    found = structured(call("search_items", query="gardening"))["items"]

    assert [item["excerpt"] for item in found] == ["Ideas about gardening"]


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
    assert "No item" in failure(call("get_item", id=str(item.id)))


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
