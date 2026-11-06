import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from apps.accounts.models import Profile


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


def tutorial(client):
    return client.get("/api/auth/session/").json()["tutorial"]


def post(client, **payload):
    return client.post("/api/auth/tutorial/", payload, content_type="application/json")


def test_a_new_user_has_not_started_it(client):
    assert tutorial(client) == {"started": False, "done": [], "closed": False}


def test_progress_holds_on_every_device(client, user):
    assert post(client, action="start").status_code == 204
    post(client, action="done", part="loop")
    post(client, action="done", part="graph")

    other_device = Client()
    other_device.force_login(user)
    assert tutorial(other_device) == {
        "started": True,
        "done": ["loop", "graph"],
        "closed": False,
    }


def test_a_part_is_ticked_once(client, user):
    post(client, action="start")
    post(client, action="done", part="boards")
    post(client, action="done", part="boards")
    assert Profile.objects.get(user=user).tutorial_done == ["boards"]


def test_closing_puts_it_away_and_starting_brings_it_back_afresh(client):
    post(client, action="start")
    post(client, action="done", part="loop")
    post(client, action="close")
    assert tutorial(client)["closed"] is True

    post(client, action="start")
    assert tutorial(client) == {"started": True, "done": [], "closed": False}


def test_closing_again_keeps_the_first_time(client, user):
    post(client, action="close")
    first = Profile.objects.get(user=user).tutorial_closed_at
    post(client, action="close")
    assert Profile.objects.get(user=user).tutorial_closed_at == first


@pytest.mark.parametrize(
    "payload",
    [
        {"action": "done"},
        {"action": "done", "part": "nowhere"},
        {"action": "rewind"},
    ],
)
def test_it_refuses_what_it_does_not_know(client, payload):
    assert post(client, **payload).status_code == 400


@pytest.mark.django_db
def test_it_requires_a_session():
    response = Client().post(
        "/api/auth/tutorial/", {"action": "start"}, content_type="application/json"
    )
    assert response.status_code == 403
