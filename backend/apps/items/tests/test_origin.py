import pytest
from rest_framework.test import APIClient

from apps.accounts.models import ApiToken, OAuthClient
from apps.items.models import Item
from apps.items.origin import Source, acting, app_name


def note(owner, body="Hello", **fields):
    return Item.objects.create(owner=owner, kind=Item.Kind.NOTE, body=body, **fields)


def as_token(user, token):
    client = APIClient()
    client.force_authenticate(user, token=token)
    return client


def test_what_the_user_captures_in_the_app_is_theirs_from_the_web(api):
    data = api.post("/api/items/capture/", {"text": "Idea"}, format="json").json()

    assert (data["created_by"], data["created_via"]) == ("", "web")
    assert data["edited_at"] is None


def test_what_a_token_captures_is_its_through_the_api(user):
    token, _ = ApiToken.issue(user, "My script")

    response = as_token(user, token).post(
        "/api/items/capture/", {"text": "Idea"}, format="json"
    )

    item = Item.objects.get(id=response.json()["id"])
    assert (item.created_by, item.created_via) == ("My script", Source.API)


def test_a_connected_app_goes_by_its_name():
    token = ApiToken(name="Signed in", client=OAuthClient(name="ChatGPT"))

    assert app_name(token) == "ChatGPT"


@pytest.mark.django_db
def test_without_an_origin_the_source_is_unknown(user):
    item = note(user)

    assert (item.created_by, item.created_via) == ("", Source.UNKNOWN)


@pytest.mark.django_db
def test_acting_says_who_makes_items(user):
    with acting(Source.MCP, by="Claude"):
        item = note(user)

    assert (item.created_by, item.created_via) == ("Claude", Source.MCP)


def test_editing_records_who_and_when(user):
    item = note(user)
    token, _ = ApiToken.issue(user, "Claude")

    data = (
        as_token(user, token)
        .patch(f"/api/items/{item.id}/", {"body": "Changed"}, format="json")
        .json()
    )

    assert (data["edited_by"], data["edited_via"]) == ("Claude", "api")
    assert data["edited_at"] is not None
    # Who made it stays.
    assert (data["created_by"], data["created_via"]) == ("", "")


def test_renaming_a_file_is_an_edit(api, user):
    item = Item.objects.create(
        owner=user, kind=Item.Kind.FILE, title="a.pdf", metadata={"filename": "a.pdf"}
    )

    api.patch(f"/api/items/{item.id}/", {"filename": "b"}, format="json")

    item.refresh_from_db()
    assert (item.edited_via, item.edited_at is not None) == (Source.WEB, True)


def test_saving_the_same_content_or_triage_is_not_an_edit(api, user):
    item = note(user)

    api.patch(f"/api/items/{item.id}/", {"body": "Hello"}, format="json")
    api.post(
        "/api/items/triage/",
        {"ids": [str(item.id)], "action": "archive"},
        format="json",
    )

    item.refresh_from_db()
    assert item.status == Item.Status.ARCHIVED
    assert item.edited_at is None


@pytest.fixture
def origins(user):
    mine = note(user, "mine")
    with acting(Source.MCP, by="Claude"):
        claude = note(user, "claude")
    with acting(Source.API, by="ChatGPT"):
        chatgpt = note(user, "chatgpt")
    # Made by the user, last edited by an assistant.
    edited = note(user, "edited", edited_by="Claude", edited_via=Source.MCP)
    return {"mine": mine, "claude": claude, "chatgpt": chatgpt, "edited": edited}


def listed(api, query):
    return {item["body"] for item in api.get(f"/api/items/?{query}").json()["results"]}


def test_filter_by_origin(api, origins):
    assert listed(api, "origin=mine") == {"mine"}
    assert listed(api, "origin=assistants") == {"claude", "chatgpt", "edited"}
    assert listed(api, "app=Claude") == {"claude", "edited"}
    assert listed(api, "app=ChatGPT&origin=assistants") == {"chatgpt"}


def test_the_apps_to_filter_by(api, origins, other_user):
    with acting(Source.MCP, by="Grok"):
        note(other_user)

    assert api.get("/api/items/apps/").json() == {"apps": ["ChatGPT", "Claude"]}
