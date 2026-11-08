from config.env import get_env_variable

from .base import *  # noqa: F403

DEBUG = True

SECRET_KEY = "django-insecure-brainbro-develop-only-key"

# HTTPS tunnels to try the PWA on a phone (`make preview`, then ngrok or
# cloudflared to :8000): service workers need HTTPS.
TUNNEL_DOMAINS = [".ngrok-free.app", ".trycloudflare.com"]

APP_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", *TUNNEL_DOMAINS]

# Vite dev server proxies /api to Django, so requests arrive with its origin.
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    *(f"https://*{domain}" for domain in TUNNEL_DOMAINS),
]

# The tunnel terminates TLS and forwards the original scheme.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Blogs locally: `http://blog.localhost:8000/`, served by Django (`make
# preview`). Browsers send every `*.localhost` to this machine.
SITE_SCHEME = "http"
SITE_PORT = get_env_variable("SITE_PORT", "8000")

# The embedder from docker-compose.yml (`make services`).
EMBEDDER_URL = get_env_variable("EMBEDDER_URL", "http://localhost:8100")

UNFOLD["SITE_TITLE"] += " (develop)"  # noqa: F405
