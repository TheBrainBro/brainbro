import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from apps.core import mail
from apps.core.models import EmailSettings

URL = "/api/server/email/"

MAILGUN = {
    "provider": "mailgun",
    "from_email": "",
    "mailgun_domain": "Mail.Example.com",
    "mailgun_region": "eu",
    "mailgun_api_key": "key-from-the-app",
}


@pytest.fixture(autouse=True)
def no_environment(settings):
    settings.EMAIL_PROVIDER = ""
    settings.EMAIL_FROM = ""
    settings.MAILGUN_API_KEY = ""
    settings.MAILGUN_DOMAIN = ""
    settings.MAILGUN_REGION = "us"


@pytest.fixture
def admin_user(db):
    return get_user_model().objects.create_user(
        username="admin", password="pw", is_staff=True, email="admin@example.com"
    )


@pytest.fixture
def admin(admin_user):
    client = Client()
    client.force_login(admin_user)
    return client


def put(client, data):
    return client.put(URL, data, content_type="application/json")


def test_only_admins_see_it(db):
    user = get_user_model().objects.create_user(username="alex", password="pw")
    client = Client()
    client.force_login(user)

    assert client.get(URL).status_code == 403
    assert put(client, MAILGUN).status_code == 403
    assert Client().get(URL).status_code in (401, 403)


def test_it_starts_off(admin):
    assert admin.get(URL).json() == {
        "source": "environment",
        "enabled": False,
        "provider": "",
        "from_email": "",
        "default_from": "",
        "mailgun_domain": "",
        "mailgun_region": "us",
        "has_api_key": False,
        "environment_enabled": False,
    }


def test_saving_turns_email_on_with_the_key_encrypted(admin):
    response = put(admin, MAILGUN)

    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "database"
    assert data["enabled"] is True
    assert data["mailgun_domain"] == "mail.example.com"
    assert data["default_from"] == "BrainBro <noreply@mail.example.com>"
    assert data["has_api_key"] is True
    assert "mailgun_api_key" not in data
    saved = EmailSettings.objects.get()
    assert saved.mailgun_api_key and "key-from-the-app" not in saved.mailgun_api_key
    assert mail.provider().options == {
        "api_key": "key-from-the-app",
        "sender_domain": "mail.example.com",
        "api_url": "https://api.eu.mailgun.net/v3",
    }
    assert admin.get("/api/auth/session/").json()["email_enabled"] is True


def test_a_blank_key_keeps_the_one_in_use(admin):
    put(admin, MAILGUN)

    put(admin, {**MAILGUN, "mailgun_api_key": "", "from_email": "Notes <a@b.com>"})

    assert mail.provider().options["api_key"] == "key-from-the-app"
    assert mail.from_email() == "Notes <a@b.com>"


def test_saving_over_the_environment_keeps_its_key(admin, settings):
    settings.EMAIL_PROVIDER = "mailgun"
    settings.MAILGUN_API_KEY = "key-from-the-environment"
    settings.MAILGUN_DOMAIN = "env.example.com"
    assert admin.get(URL).json()["has_api_key"] is True

    put(admin, {**MAILGUN, "mailgun_api_key": ""})

    assert mail.config().source == "database"
    assert mail.provider().options["api_key"] == "key-from-the-environment"


def test_mailgun_needs_a_domain_and_a_key(admin):
    response = put(admin, {**MAILGUN, "mailgun_domain": "", "mailgun_api_key": ""})

    assert response.status_code == 400
    assert set(response.json()) == {"mailgun_domain", "mailgun_api_key"}
    assert not EmailSettings.objects.exists()


def test_saving_no_provider_turns_email_off_over_the_environment(admin, settings):
    settings.EMAIL_PROVIDER = "mailgun"
    settings.MAILGUN_API_KEY = "key"
    settings.MAILGUN_DOMAIN = "env.example.com"

    data = put(admin, {"provider": ""}).json()

    assert data["enabled"] is False
    assert data["environment_enabled"] is True
    assert not mail.enabled()


def test_going_back_to_the_environment(admin, settings):
    put(admin, MAILGUN)
    settings.EMAIL_PROVIDER = "mailgun"
    settings.MAILGUN_API_KEY = "key"
    settings.MAILGUN_DOMAIN = "env.example.com"

    data = admin.delete(URL).json()

    assert data["source"] == "environment"
    assert data["mailgun_domain"] == "env.example.com"
    assert not EmailSettings.objects.exists()


def test_a_key_unreadable_after_secret_key_changes_turns_email_off(admin, settings):
    put(admin, MAILGUN)
    settings.SECRET_KEY = "another-secret-key"

    assert not mail.enabled()
    assert [check.id for check in mail.check_provider(None)] == ["core.W002"]


def test_a_test_email_goes_to_the_admin(admin, mailoutbox):
    put(admin, MAILGUN)

    response = admin.post(f"{URL}test/")

    assert response.status_code == 200
    assert response.json() == {"sent_to": "admin@example.com", "provider": "Mailgun"}
    [message] = mailoutbox
    assert message.to == ["admin@example.com"]
    assert message.from_email == "BrainBro <noreply@mail.example.com>"


def test_the_test_needs_email_on_and_the_admins_email(admin, admin_user):
    assert admin.post(f"{URL}test/").status_code == 400
    put(admin, MAILGUN)
    admin_user.email = ""
    admin_user.save()

    response = admin.post(f"{URL}test/")

    assert response.status_code == 400
    assert "Profile" in response.json()["detail"]


def test_the_test_says_why_the_provider_refused(admin, monkeypatch):
    put(admin, MAILGUN)

    def refuse(*args, **kwargs):
        raise RuntimeError("Forbidden")

    monkeypatch.setattr(mail, "send_mail", refuse)

    response = admin.post(f"{URL}test/")

    assert response.status_code == 400
    assert response.json() == {"detail": "The email couldn't be sent: Forbidden"}
