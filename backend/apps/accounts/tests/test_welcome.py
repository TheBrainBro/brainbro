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


def test_session_says_the_welcome_was_not_seen(client):
    assert client.get("/api/auth/session/").json()["welcome_seen"] is False


def test_marking_the_welcome_seen_holds_for_every_session(client, user):
    response = client.post("/api/auth/welcome/")
    assert response.status_code == 204

    other_device = Client()
    other_device.force_login(user)
    assert other_device.get("/api/auth/session/").json()["welcome_seen"] is True


def test_marking_it_again_keeps_the_first_time(client, user):
    client.post("/api/auth/welcome/")
    first = Profile.objects.get(user=user).welcome_seen_at

    client.post("/api/auth/welcome/")

    assert Profile.objects.get(user=user).welcome_seen_at == first


@pytest.mark.django_db
def test_marking_it_requires_a_session():
    assert Client().post("/api/auth/welcome/").status_code == 403
