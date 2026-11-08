from .base import *  # noqa: F403
from .base import get_env_variable

DEBUG = False

SECRET_KEY = get_env_variable("SECRET_KEY")

# Public hostname(s) served through the Cloudflare Tunnel, comma-separated.
APP_HOSTNAMES = [
    host.strip()
    for host in get_env_variable("APP_HOSTNAMES").split(",")
    if host.strip()
]

# "api" is the container name, used by the healthcheck and internal calls.
APP_HOSTS = APP_HOSTNAMES + ["api", "localhost", "127.0.0.1"]

CSRF_TRUSTED_ORIGINS = [f"https://{host}" for host in APP_HOSTNAMES]

# The bot's updates come through the tunnel, like everything else.
TELEGRAM_WEBHOOK_URL = TELEGRAM_WEBHOOK_URL or (  # noqa: F405
    f"https://{APP_HOSTNAMES[0]}/api/telegram/webhook/"
)

# Cloudflare terminates TLS and forwards the original scheme.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
