from .base import *  # noqa: F403

DEBUG = True

SECRET_KEY = "django-insecure-brain-develop-only-key"

ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0"]

# Vite dev server proxies /api to Django, so requests arrive with its origin.
CSRF_TRUSTED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

UNFOLD["SITE_TITLE"] += " (develop)"  # noqa: F405
