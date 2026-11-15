from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .base import get_env_variable

DEBUG = False

SECRET_KEY = get_env_variable("SECRET_KEY")
# The placeholder in stack.env.example: with it, anyone could sign session
# cookies for any user of this server.
if SECRET_KEY == "CHANGE_ME":
    raise ImproperlyConfigured(
        "SECRET_KEY is still CHANGE_ME. Set it in stack.env (openssl rand -base64 48)."
    )

# Public hostname(s) served through the Cloudflare Tunnel, comma-separated.
APP_HOSTNAMES = [
    host.strip()
    for host in get_env_variable("APP_HOSTNAMES").split(",")
    if host.strip()
]

# Off only on a local network without TLS: browsers won't send Secure cookies
# over plain HTTP, so nobody could sign in. A mistyped value keeps HTTPS on.
APP_HTTPS = get_env_variable("APP_HTTPS", "true").strip().lower() not in (
    "false",
    "0",
    "no",
    "off",
)
APP_SCHEME = "https" if APP_HTTPS else "http"

# "api" is the container name, used by the healthcheck and internal calls.
APP_HOSTS = APP_HOSTNAMES + ["api", "localhost", "127.0.0.1"]

CSRF_TRUSTED_ORIGINS = [f"{APP_SCHEME}://{host}" for host in APP_HOSTNAMES]

SITE_SCHEME = APP_SCHEME

# The bot's updates come through the tunnel, like everything else. Telegram
# only delivers to HTTPS addresses, so without it there is no default.
if APP_HTTPS:
    TELEGRAM_WEBHOOK_URL = TELEGRAM_WEBHOOK_URL or (  # noqa: F405
        f"https://{APP_HOSTNAMES[0]}/api/telegram/webhook/"
    )

    # The tunnel or Caddy terminates TLS and forwards the original scheme.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

    # Browsers remember this, so it starts short: one hour. It stays off
    # subdomains and the preload list, because blogs on their owners' domains
    # answer here too and those owners' other subdomains are not ours.
    SECURE_HSTS_SECONDS = 3600
    SECURE_HSTS_INCLUDE_SUBDOMAINS = False
    SECURE_HSTS_PRELOAD = False

SESSION_COOKIE_SECURE = APP_HTTPS
CSRF_COOKIE_SECURE = APP_HTTPS
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
