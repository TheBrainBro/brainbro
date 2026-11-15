"""
Transactional email, sent through the provider the server is set up with.

Which provider and its credentials are read in one place, `config()`: from
the settings an admin saved in Settings, Server, Email, or, while there are
none, from the environment (`EMAIL_PROVIDER` and the provider's own
variables). Adding a provider is one more entry in `PROVIDERS`: Anymail
(https://anymail.dev) already speaks to most of them.

Django's `send_mail` and friends go through `EmailBackend`, the default
mailer in `MAILERS`, which hands each message to the provider. With no
provider, nothing is sent and `enabled()` says so, so the app hides what
needs email.
"""

import logging
from dataclasses import dataclass, field

from django.apps import apps
from django.conf import settings
from django.core.checks import Warning, register
from django.core.mail import send_mail
from django.core.mail.backends.base import BaseEmailBackend
from django.db import DatabaseError
from django.utils.module_loading import import_string

from . import secrets

logger = logging.getLogger(__name__)

MAILGUN_API_URLS = {
    "us": "https://api.mailgun.net/v3",
    "eu": "https://api.eu.mailgun.net/v3",
}

DATABASE = "database"
ENVIRONMENT = "environment"


@dataclass(frozen=True)
class Config:
    """What the server is set up with, whichever place it came from."""

    source: str
    provider: str = ""
    from_email: str = ""
    mailgun_api_key: str = ""
    mailgun_domain: str = ""
    mailgun_region: str = "us"


@dataclass(frozen=True)
class Provider:
    name: str
    # The Django email backend that talks to it.
    backend: str
    # Given to that backend: credentials and where to reach it.
    options: dict = field(default_factory=dict)
    # The sender when the server doesn't set one.
    default_from: str = ""


def environment_config():
    return Config(
        source=ENVIRONMENT,
        provider=settings.EMAIL_PROVIDER,
        from_email=settings.EMAIL_FROM,
        mailgun_api_key=settings.MAILGUN_API_KEY,
        mailgun_domain=settings.MAILGUN_DOMAIN,
        mailgun_region=settings.MAILGUN_REGION,
    )


def saved_settings():
    """The settings saved from the app, if any."""
    # By name: apps.core.apps imports this module before models are ready.
    EmailSettings = apps.get_model("core", "EmailSettings")
    try:
        return EmailSettings.objects.first()
    except DatabaseError:
        # Before the first migration: only the environment counts.
        return None


def config():
    saved = saved_settings()
    if saved is None:
        return environment_config()
    return Config(
        source=DATABASE,
        provider=saved.provider,
        from_email=saved.from_email,
        mailgun_api_key=secrets.decrypt(saved.mailgun_api_key),
        mailgun_domain=saved.mailgun_domain,
        mailgun_region=saved.mailgun_region,
    )


def mailgun(current):
    domain = current.mailgun_domain
    if not current.mailgun_api_key or not domain:
        return None
    api_url = MAILGUN_API_URLS.get(current.mailgun_region)
    if api_url is None:
        return None
    return Provider(
        name="mailgun",
        backend="anymail.backends.mailgun.EmailBackend",
        options={
            "api_key": current.mailgun_api_key,
            "sender_domain": domain,
            "api_url": api_url,
        },
        default_from=f"noreply@{domain}",
    )


# Each one returns its Provider for a Config, or None while it is missing a
# setting.
PROVIDERS = {
    "mailgun": mailgun,
}


def provider(current=None):
    """The provider that sends this server's email, or None."""
    current = current or config()
    make = PROVIDERS.get(current.provider)
    return make(current) if make else None


def enabled():
    return provider() is not None


def default_from(current=None):
    """The sender when none is set: `APP_NAME <noreply@...>`, or ""."""
    found = provider(current)
    address = found.default_from if found else ""
    return f"{settings.APP_NAME} <{address}>" if address else ""


def from_email(current=None):
    """Who the email comes from: the one set, or the provider's default."""
    current = current or config()
    return current.from_email or default_from(current)


def send(subject, body, to):
    """Sends one plain text email; raises if the provider refuses it."""
    return send_mail(
        subject=subject, message=body, from_email=from_email(), recipient_list=to
    )


class EmailBackend(BaseEmailBackend):
    """Hands each message to the configured provider; drops them without one."""

    def send_messages(self, email_messages):
        current = provider()
        if current is None:
            if email_messages:
                logger.warning(
                    "Email is off: %d message(s) not sent.", len(email_messages)
                )
            return 0
        backend = import_string(current.backend)(alias=self.alias, **current.options)
        return backend.send_messages(email_messages)


@register()
def check_provider(app_configs, **kwargs):
    """Says why email is off when it was meant to be on."""
    current = config()
    name = current.provider
    where = (
        "The email settings saved in the app"
        if current.source == DATABASE
        else "EMAIL_PROVIDER"
    )
    if not name:
        return []
    if name not in PROVIDERS:
        return [
            Warning(
                f"{where}: {name!r} is not a provider BrainBro knows: use one of "
                f"{', '.join(sorted(PROVIDERS))}. Email is off.",
                id="core.W001",
            )
        ]
    if provider(current) is None:
        return [
            Warning(
                f"{where}: {name!r} is missing settings. Email is off.",
                hint="See docs/deployment.md, Email. A saved API key can't be "
                "read after SECRET_KEY changes: enter it again.",
                id="core.W002",
            )
        ]
    return []
