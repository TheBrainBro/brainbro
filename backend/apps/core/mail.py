"""
Transactional email, sent through the provider the server is set up with.

Which provider and its credentials are read in one place, `provider()`: today
from the environment (`EMAIL_PROVIDER` and the provider's own variables), so
a Settings panel can later store them and take precedence without touching
what sends. Adding a provider is one more entry in `PROVIDERS`: Anymail
(https://anymail.dev) already speaks to most of them.

Django's `send_mail` and friends go through `EmailBackend`, the default
mailer in `MAILERS`, which hands each message to the provider. With no
provider, nothing is sent and `enabled()` says so, so the app hides what
needs email.
"""

import logging
from dataclasses import dataclass, field

from django.conf import settings
from django.core.checks import Warning, register
from django.core.mail.backends.base import BaseEmailBackend
from django.utils.module_loading import import_string

logger = logging.getLogger(__name__)

MAILGUN_API_URLS = {
    "us": "https://api.mailgun.net/v3",
    "eu": "https://api.eu.mailgun.net/v3",
}


@dataclass(frozen=True)
class Provider:
    name: str
    # The Django email backend that talks to it.
    backend: str
    # Given to that backend: credentials and where to reach it.
    options: dict = field(default_factory=dict)
    # The sender when the server doesn't set one.
    default_from: str = ""


def mailgun():
    domain = settings.MAILGUN_DOMAIN
    if not settings.MAILGUN_API_KEY or not domain:
        return None
    api_url = MAILGUN_API_URLS.get(settings.MAILGUN_REGION)
    if api_url is None:
        return None
    return Provider(
        name="mailgun",
        backend="anymail.backends.mailgun.EmailBackend",
        options={
            "api_key": settings.MAILGUN_API_KEY,
            "sender_domain": domain,
            "api_url": api_url,
        },
        default_from=f"noreply@{domain}",
    )


# Each one returns its Provider, or None while it is missing a setting.
PROVIDERS = {
    "mailgun": mailgun,
}


def provider():
    """The provider that sends this server's email, or None."""
    make = PROVIDERS.get(settings.EMAIL_PROVIDER)
    return make() if make else None


def enabled():
    return provider() is not None


def from_email():
    """Who the email comes from: `EMAIL_FROM`, or the provider's default."""
    if settings.EMAIL_FROM:
        return settings.EMAIL_FROM
    current = provider()
    address = current.default_from if current else ""
    return f"{settings.APP_NAME} <{address}>" if address else ""


class EmailBackend(BaseEmailBackend):
    """Hands each message to the configured provider; drops them without one."""

    def send_messages(self, email_messages):
        current = provider()
        if current is None:
            if email_messages:
                logger.warning(
                    "Email is off (EMAIL_PROVIDER): %d message(s) not sent.",
                    len(email_messages),
                )
            return 0
        backend = import_string(current.backend)(alias=self.alias, **current.options)
        return backend.send_messages(email_messages)


@register()
def check_provider(app_configs, **kwargs):
    """Says at startup why email is off when it was meant to be on."""
    name = settings.EMAIL_PROVIDER
    if not name:
        return []
    if name not in PROVIDERS:
        return [
            Warning(
                f"EMAIL_PROVIDER={name!r} is not a provider BrainBro knows: "
                f"use one of {', '.join(sorted(PROVIDERS))}. Email is off.",
                id="core.W001",
            )
        ]
    if provider() is None:
        return [
            Warning(
                f"EMAIL_PROVIDER={name!r} is missing settings. Email is off.",
                hint="See docs/deployment.md, Email.",
                id="core.W002",
            )
        ]
    return []
