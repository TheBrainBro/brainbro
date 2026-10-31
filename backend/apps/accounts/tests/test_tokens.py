from datetime import timedelta

import pytest
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import ApiToken
from apps.items.models import Item


@pytest.fixture
def session(user):
    client = Client()
    client.force_login(user)
    return client


def bearer(key):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {key}")
    return client


def test_a_new_token_is_shown_once_and_stored_hashed(session, user):
    response = session.post(
        "/api/auth/tokens/", {"name": "Claude"}, content_type="application/json"
    )

    assert response.status_code == 201
    key = response.json()["token"]
    assert key.startswith("brain_")
    token = ApiToken.objects.get(owner=user)
    assert token.name == "Claude"
    assert key not in (token.key_hash, token.prefix)
    assert key.startswith(token.prefix)
    listed = session.get("/api/auth/tokens/").json()
    assert [entry["name"] for entry in listed] == ["Claude"]
    assert "token" not in listed[0]


def test_a_token_needs_a_name(session):
    response = session.post(
        "/api/auth/tokens/", {"name": ""}, content_type="application/json"
    )
    assert response.status_code == 400


def test_a_token_acts_as_its_owner(user, other_user):
    _, key = ApiToken.issue(user, "Script")
    Item.objects.create(owner=user, kind=Item.Kind.NOTE, body="mine")
    Item.objects.create(owner=other_user, kind=Item.Kind.NOTE, body="theirs")

    response = bearer(key).get("/api/items/")

    assert response.status_code == 200
    assert [item["body"] for item in response.json()["results"]] == ["mine"]


def test_a_token_writes_without_csrf(user):
    _, key = ApiToken.issue(user, "Script")
    client = APIClient(enforce_csrf_checks=True)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {key}")

    response = client.post("/api/items/capture/", {"text": "hello"}, format="json")

    assert response.status_code == 201
    assert Item.objects.get(owner=user).body == "hello"


@pytest.mark.django_db
def test_a_wrong_token_is_refused():
    assert bearer("brain_nope").get("/api/items/").status_code == 403


def test_an_inactive_owner_s_token_is_refused(user):
    _, key = ApiToken.issue(user, "Script")
    user.is_active = False
    user.save()
    assert bearer(key).get("/api/items/").status_code == 403


def test_using_a_token_records_when(user):
    token, key = ApiToken.issue(user, "Script")

    bearer(key).get("/api/items/")

    token.refresh_from_db()
    assert token.last_used_at is not None


def test_last_used_is_not_written_on_every_request(user):
    token, key = ApiToken.issue(user, "Script")
    recent = timezone.now() - timedelta(seconds=10)
    ApiToken.objects.filter(pk=token.pk).update(last_used_at=recent)

    bearer(key).get("/api/items/")

    token.refresh_from_db()
    assert token.last_used_at == recent


def test_revoking_a_token_stops_it(session, user):
    token, key = ApiToken.issue(user, "Script")

    assert session.delete(f"/api/auth/tokens/{token.id}/").status_code == 204

    assert not ApiToken.objects.exists()
    assert bearer(key).get("/api/items/").status_code == 403


def test_someone_else_s_token_cannot_be_revoked(session, other_user):
    token, _ = ApiToken.issue(other_user, "Theirs")

    session.delete(f"/api/auth/tokens/{token.id}/")

    assert ApiToken.objects.filter(pk=token.pk).exists()


def test_tokens_are_listed_per_user(session, other_user):
    ApiToken.issue(other_user, "Theirs")
    assert session.get("/api/auth/tokens/").json() == []


def test_a_token_cannot_manage_tokens(user):
    _, key = ApiToken.issue(user, "Script")
    client = bearer(key)

    assert client.get("/api/auth/tokens/").status_code == 403
    assert client.post("/api/auth/tokens/", {"name": "More"}).status_code == 403
