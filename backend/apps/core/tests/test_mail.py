import pytest
from django.core import mail as outbox
from django.core.mail import send_mail

from apps.core import mail

# Tests send through the in-memory mailer; these put the real one back.
MAILERS = {"default": {"BACKEND": "apps.core.mail.EmailBackend"}}


@pytest.fixture
def mailgun(settings):
    settings.EMAIL_PROVIDER = "mailgun"
    settings.MAILGUN_API_KEY = "key-123"
    settings.MAILGUN_DOMAIN = "mail.example.com"
    settings.MAILGUN_REGION = "us"
    settings.EMAIL_FROM = ""


def test_email_is_off_without_a_provider(settings):
    settings.EMAIL_PROVIDER = ""

    assert mail.provider() is None
    assert not mail.enabled()
    assert mail.check_provider(None) == []


def test_mailgun_is_set_up_from_the_environment(mailgun):
    provider = mail.provider()

    assert provider.backend == "anymail.backends.mailgun.EmailBackend"
    assert provider.options == {
        "api_key": "key-123",
        "sender_domain": "mail.example.com",
        "api_url": "https://api.mailgun.net/v3",
    }
    assert mail.from_email() == "BrainBro <noreply@mail.example.com>"
    assert mail.check_provider(None) == []


def test_mailgun_in_the_eu(mailgun, settings):
    settings.MAILGUN_REGION = "eu"

    assert mail.provider().options["api_url"] == "https://api.eu.mailgun.net/v3"


def test_the_sender_can_be_set(mailgun, settings):
    settings.EMAIL_FROM = "Notes <hi@example.com>"

    assert mail.from_email() == "Notes <hi@example.com>"


@pytest.mark.parametrize(
    "setting", ["MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_REGION"]
)
def test_a_missing_setting_turns_email_off_with_a_warning(mailgun, settings, setting):
    setattr(settings, setting, "" if setting != "MAILGUN_REGION" else "asia")

    assert not mail.enabled()
    assert [check.id for check in mail.check_provider(None)] == ["core.W002"]


def test_an_unknown_provider_warns(settings):
    settings.EMAIL_PROVIDER = "carrier-pigeon"

    assert not mail.enabled()
    assert [check.id for check in mail.check_provider(None)] == ["core.W001"]


def test_the_backend_hands_messages_to_the_provider(mailgun, settings, monkeypatch):
    sent = []

    class Fake:
        def __init__(self, **options):
            sent.append(options)

        def send_messages(self, messages):
            sent.extend(messages)
            return len(messages)

    def fake_import(path):
        return lambda **options: Fake(backend=path, **options)

    monkeypatch.setattr(mail, "import_string", fake_import)
    settings.MAILERS = MAILERS

    assert send_mail("Hi", "Body", "a@example.com", ["b@example.com"]) == 1
    assert sent[0]["backend"] == "anymail.backends.mailgun.EmailBackend"
    assert sent[0]["api_key"] == "key-123"
    assert sent[1].subject == "Hi"


def test_without_a_provider_nothing_is_sent(settings):
    settings.EMAIL_PROVIDER = ""
    settings.MAILERS = MAILERS

    assert send_mail("Hi", "Body", "a@example.com", ["b@example.com"]) == 0
    assert outbox.outbox == []
