import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import Client


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(
        username="alex", email="c@example.com", password="s3cret-pass"
    )


@pytest.fixture
def csrf_client():
    return Client(enforce_csrf_checks=True)


def get_csrf(client):
    client.get("/api/auth/session/")
    return client.cookies["csrftoken"].value


@pytest.mark.django_db
def test_session_anonymous_sets_csrf_cookie(csrf_client):
    response = csrf_client.get("/api/auth/session/")
    assert response.json() == {"authenticated": False, "user": None}
    assert "csrftoken" in response.cookies


def test_login_requires_csrf(csrf_client, user):
    response = csrf_client.post(
        "/api/auth/login/",
        {"username": "alex", "password": "s3cret-pass"},
        content_type="application/json",
    )
    assert response.status_code == 403


def test_login_logout_flow(csrf_client, user):
    token = get_csrf(csrf_client)

    response = csrf_client.post(
        "/api/auth/login/",
        {"username": "alex", "password": "s3cret-pass"},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "alex"

    session = csrf_client.get("/api/auth/session/").json()
    assert session["authenticated"] is True

    # Login rotates the CSRF token.
    token = csrf_client.cookies["csrftoken"].value
    response = csrf_client.post("/api/auth/logout/", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 204
    assert csrf_client.get("/api/auth/session/").json()["authenticated"] is False


def test_login_wrong_password(csrf_client, user):
    token = get_csrf(csrf_client)
    response = csrf_client.post(
        "/api/auth/login/",
        {"username": "alex", "password": "nope"},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_logout_requires_authentication(client):
    assert client.post("/api/auth/logout/").status_code == 403


@pytest.mark.django_db
def test_ensure_admin_creates_once(monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_PASSWORD", "first-pass")
    call_command("ensure_admin")

    monkeypatch.setenv("ADMIN_PASSWORD", "second-pass")
    call_command("ensure_admin")

    admin = get_user_model().objects.get(username="admin")
    assert admin.is_superuser
    assert admin.check_password("first-pass")


def test_session_links_the_source_code(client, user, settings):
    settings.SOURCE_CODE_URL = "https://git.example.com/me/brainbro"
    client.force_login(user)
    session = client.get("/api/auth/session/").json()
    assert session["source_code_url"] == "https://git.example.com/me/brainbro"
