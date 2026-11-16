from .base import *  # noqa: F403

DEBUG = False

SECRET_KEY = "django-insecure-brainbro-testing-only-key"

APP_HOSTS = ["testserver", "localhost"]

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

STORAGES["staticfiles"] = {  # noqa: F405
    "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
}

# Tests that need vectors fake the embedder.
EMBEDDER_URL = ""

EMBED_HOSTNAME = "embed.testserver"
EMBED_URL = "http://embed.testserver"

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
