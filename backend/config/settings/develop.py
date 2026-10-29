from .base import *  # noqa: F403

DEBUG = True

SECRET_KEY = "django-insecure-brain-develop-only-key"

# HTTPS tunnels to try the PWA on a phone (`make preview`, then ngrok or
# cloudflared to :8000): service workers need HTTPS.
TUNNEL_DOMAINS = [".ngrok-free.app", ".trycloudflare.com"]

ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", *TUNNEL_DOMAINS]

# Vite dev server proxies /api to Django, so requests arrive with its origin.
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    *(f"https://*{domain}" for domain in TUNNEL_DOMAINS),
]

# The tunnel terminates TLS and forwards the original scheme.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

UNFOLD["SITE_TITLE"] += " (develop)"  # noqa: F405
