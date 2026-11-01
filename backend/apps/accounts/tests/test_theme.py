import pytest
from django.contrib.auth import get_user_model
from django.test import Client


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(
        username="carlos", password="s3cret-pass"
    )


@pytest.fixture
def client(user):
    client = Client()
    client.force_login(user)
    return client


def put_theme(client, theme):
    return client.put(
        "/api/auth/theme/", {"theme": theme}, content_type="application/json"
    )


def test_the_theme_follows_the_system_by_default(client):
    assert client.get("/api/auth/session/").json()["theme"] == "system"


def test_the_chosen_theme_holds_for_every_session(client, user):
    assert put_theme(client, "dark").status_code == 204

    other_device = Client()
    other_device.force_login(user)
    assert other_device.get("/api/auth/session/").json()["theme"] == "dark"


def test_the_theme_can_go_back_to_the_system(client):
    put_theme(client, "light")
    put_theme(client, "system")

    assert client.get("/api/auth/session/").json()["theme"] == "system"


def test_an_unknown_theme_is_refused(client):
    assert put_theme(client, "sepia").status_code == 400
    assert client.get("/api/auth/session/").json()["theme"] == "system"


@pytest.mark.django_db
def test_choosing_a_theme_requires_a_session():
    assert put_theme(Client(), "dark").status_code == 403
