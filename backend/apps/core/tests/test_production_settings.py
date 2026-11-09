import importlib
import sys

import pytest

PRODUCTION = "config.settings.production"


@pytest.fixture
def production(monkeypatch):
    """Loads the production settings module with the given environment."""

    def load(**env):
        monkeypatch.setenv("SECRET_KEY", "test")
        monkeypatch.setenv("APP_HOSTNAMES", "brain.example.com")
        monkeypatch.delenv("APP_HTTPS", raising=False)
        monkeypatch.setattr("config.settings.base.TELEGRAM_WEBHOOK_URL", "")
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        sys.modules.pop(PRODUCTION, None)
        return importlib.import_module(PRODUCTION)

    yield load
    sys.modules.pop(PRODUCTION, None)


def test_https_is_the_default(production):
    settings = production()
    assert settings.SESSION_COOKIE_SECURE is True
    assert settings.CSRF_COOKIE_SECURE is True
    assert settings.CSRF_TRUSTED_ORIGINS == ["https://brain.example.com"]
    assert settings.SITE_SCHEME == "https"
    assert settings.SECURE_PROXY_SSL_HEADER == ("HTTP_X_FORWARDED_PROTO", "https")
    assert (
        settings.TELEGRAM_WEBHOOK_URL
        == "https://brain.example.com/api/telegram/webhook/"
    )


@pytest.mark.parametrize("value", ["false", "False", " FALSE ", "0", "no", "off"])
def test_plain_http_on_a_local_network(production, value):
    settings = production(APP_HTTPS=value)
    assert settings.SESSION_COOKIE_SECURE is False
    assert settings.CSRF_COOKIE_SECURE is False
    assert settings.CSRF_TRUSTED_ORIGINS == ["http://brain.example.com"]
    assert settings.SITE_SCHEME == "http"
    assert not hasattr(settings, "SECURE_PROXY_SSL_HEADER")
    assert settings.TELEGRAM_WEBHOOK_URL == ""


def test_a_mistyped_value_keeps_https(production):
    assert production(APP_HTTPS="flase").SESSION_COOKIE_SECURE is True


def test_hsts_is_short_and_only_with_https(production):
    secure = production()
    assert secure.SECURE_HSTS_SECONDS == 3600
    assert secure.SECURE_HSTS_INCLUDE_SUBDOMAINS is False
    assert secure.SECURE_HSTS_PRELOAD is False
    assert not hasattr(production(APP_HTTPS="false"), "SECURE_HSTS_SECONDS")


@pytest.fixture
def hsts(settings):
    settings.SECURE_HSTS_SECONDS = 3600
    settings.SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")


@pytest.mark.django_db
def test_hsts_header_on_requests_that_arrived_over_https(client, hsts):
    response = client.get("/api/health/", headers={"x-forwarded-proto": "https"})
    assert response.headers["Strict-Transport-Security"] == "max-age=3600"


@pytest.mark.django_db
def test_no_hsts_header_over_plain_http(client, hsts):
    response = client.get("/api/health/")
    assert "Strict-Transport-Security" not in response.headers
