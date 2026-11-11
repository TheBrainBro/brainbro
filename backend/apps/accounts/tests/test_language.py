import pytest
from django.contrib.auth import get_user_model
from django.test import Client


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(username="alex", password="s3cret-pass")


@pytest.fixture
def client(user):
    client = Client()
    client.force_login(user)
    return client


def put_language(client, language):
    return client.put(
        "/api/auth/language/", {"language": language}, content_type="application/json"
    )


def test_the_language_follows_the_system_by_default(client):
    assert client.get("/api/auth/session/").json()["language"] == "system"


def test_the_chosen_language_holds_for_every_session(client, user):
    assert put_language(client, "es").status_code == 204

    other_device = Client()
    other_device.force_login(user)
    assert other_device.get("/api/auth/session/").json()["language"] == "es"


def test_the_language_can_go_back_to_the_system(client):
    put_language(client, "en")
    put_language(client, "system")

    assert client.get("/api/auth/session/").json()["language"] == "system"


def test_an_unknown_language_is_refused(client):
    assert put_language(client, "klingon").status_code == 400
    assert client.get("/api/auth/session/").json()["language"] == "system"


@pytest.mark.django_db
def test_choosing_a_language_requires_a_session():
    assert put_language(Client(), "es").status_code == 403
