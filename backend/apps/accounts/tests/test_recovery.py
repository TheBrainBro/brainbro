import re

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client

NEW_PASSWORD = "a-brand-new-pass"


@pytest.fixture(autouse=True)
def email_on(settings):
    settings.EMAIL_PROVIDER = "mailgun"
    settings.MAILGUN_API_KEY = "key-123"
    settings.MAILGUN_DOMAIN = "mail.example.com"
    settings.MAILGUN_REGION = "us"
    settings.EMAIL_FROM = ""
    cache.clear()


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(
        username="alex", email="alex@example.com", password="the-old-pass"
    )


def ask(client, email="alex@example.com"):
    return client.post(
        "/api/auth/password-reset/", {"email": email}, content_type="application/json"
    )


def link_in(message):
    return re.search(r"http://testserver(/reset-password/(\S+)/(\S+))", message.body)


def test_a_reset_link_is_emailed(client, user, mailoutbox):
    response = ask(client, "ALEX@example.com")

    assert response.status_code == 204
    [message] = mailoutbox
    assert message.to == ["alex@example.com"]
    assert message.from_email == "BrainBro <noreply@mail.example.com>"
    assert message.subject == "Reset your BrainBro password"
    assert "alex" in message.body
    assert link_in(message)


def test_an_unknown_email_gets_the_same_answer_and_no_email(client, user, mailoutbox):
    response = ask(client, "nobody@example.com")

    assert response.status_code == 204
    assert mailoutbox == []


def test_inactive_accounts_get_no_email(client, user, mailoutbox):
    user.is_active = False
    user.save()

    assert ask(client).status_code == 204
    assert mailoutbox == []


def test_without_email_set_up_there_is_no_reset(client, user, settings, mailoutbox):
    settings.EMAIL_PROVIDER = ""

    response = ask(client)

    assert response.status_code == 404
    assert "admin" in response.json()["detail"]
    assert mailoutbox == []


def test_the_session_says_whether_email_is_on(client, settings):
    assert client.get("/api/auth/session/").json()["email_enabled"] is True
    settings.EMAIL_PROVIDER = ""
    assert client.get("/api/auth/session/").json()["email_enabled"] is False


def test_asking_requires_csrf(user):
    response = ask(Client(enforce_csrf_checks=True))

    assert response.status_code == 403


def test_asking_is_rate_limited(client, user):
    statuses = [ask(client).status_code for _ in range(6)]

    assert statuses[:5] == [204] * 5
    assert statuses[5] == 429


def test_the_link_sets_a_new_password_and_signs_in(client, user, mailoutbox):
    ask(client)
    path = link_in(mailoutbox[0]).group(1)
    api_path = f"/api/auth{path.replace('/reset-password/', '/password-reset/')}/"

    check = client.get(api_path)
    assert check.status_code == 200
    assert check.json() == {"username": "alex"}

    response = client.post(
        api_path, {"password": NEW_PASSWORD}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "alex"
    user.refresh_from_db()
    assert user.check_password(NEW_PASSWORD)

    # It works once.
    assert Client().get(api_path).status_code == 404


def test_a_weak_password_is_refused(client, user, mailoutbox):
    ask(client)
    path = link_in(mailoutbox[0]).group(1)
    api_path = f"/api/auth{path.replace('/reset-password/', '/password-reset/')}/"

    response = client.post(
        api_path, {"password": "123"}, content_type="application/json"
    )

    assert response.status_code == 400
    assert "password" in response.json()
    user.refresh_from_db()
    assert user.check_password("the-old-pass")


@pytest.mark.parametrize("uid", ["MQ", "not-base64!", "OTk5OTk5"])
def test_a_wrong_link_is_refused(client, user, uid):
    response = client.get(f"/api/auth/password-reset/{uid}/wrong-token/")

    assert response.status_code == 404


def test_the_email_is_saved_normalized(client, user):
    client.force_login(user)

    response = client.put(
        "/api/auth/email/",
        {"email": "New@EXAMPLE.com"},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json() == {"email": "New@example.com"}
    user.refresh_from_db()
    assert user.email == "New@example.com"


def test_the_email_can_be_removed(client, user):
    client.force_login(user)

    response = client.put(
        "/api/auth/email/", {"email": ""}, content_type="application/json"
    )

    assert response.status_code == 200
    user.refresh_from_db()
    assert user.email == ""


def test_another_accounts_email_is_refused(client, user):
    other = get_user_model().objects.create_user(username="bea", password="pw")
    client.force_login(other)

    response = client.put(
        "/api/auth/email/",
        {"email": "Alex@Example.com"},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json() == {"email": ["Another account already uses this email."]}


def test_saving_the_email_needs_a_session(client, db):
    response = client.put(
        "/api/auth/email/", {"email": "a@example.com"}, content_type="application/json"
    )

    assert response.status_code in (401, 403)
