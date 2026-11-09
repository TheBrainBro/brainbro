from pathlib import Path

from celery.schedules import crontab
from dotenv import load_dotenv

from config.env import get_env_variable

load_dotenv()

# backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent

ENVIRONMENT = get_env_variable("ENVIRONMENT", "develop")

APP_NAME = get_env_variable("APP_NAME", "BrainBro")

# Application definition

ADDONS_APPS = [
    "unfold",
]

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
]

THIRD_PARTY_APPS = [
    "rest_framework",
]

LOCAL_APPS = [
    "apps.core.apps.CoreConfig",
    "apps.accounts.apps.AccountsConfig",
    "apps.items.apps.ItemsConfig",
    "apps.boards.apps.BoardsConfig",
    "apps.exports.apps.ExportsConfig",
    "apps.graph.apps.GraphConfig",
    "apps.imports.apps.ImportsConfig",
    "apps.telegram.apps.TelegramConfig",
    "apps.mcp.apps.McpConfig",
    "apps.events.apps.EventsConfig",
    "apps.collab.apps.CollabConfig",
    "apps.history.apps.HistoryConfig",
    "apps.public.apps.PublicConfig",
]

INSTALLED_APPS = ADDONS_APPS + DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    # First: it decides whether the request is for the app or a blog.
    "apps.public.sites.SiteMiddleware",
    # A blog's old addresses, before its own pages.
    "apps.public.redirects.RedirectMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.events.middleware.ChangesMiddleware",
    "apps.items.origin.OriginMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

# Hosts: the app answers to `APP_HOSTS` (set per environment), and blogs to
# their verified domains, which live in the database. Django can't list
# those, so it accepts any host and `SiteMiddleware` turns away the rest.
ALLOWED_HOSTS = ["*"]
APP_HOSTS = []

# Blogs on their own domains (apps.public.sites): what their DNS records
# point at. The CNAME target defaults to the host the app is opened on; the
# A record, for root domains that can't have a CNAME, is only shown when the
# server's public IPv4 is set.
SITE_CNAME_TARGET = get_env_variable("SITE_CNAME_TARGET", "")
SITE_IPV4 = get_env_variable("SITE_IPV4", "")
# How blogs' addresses start. Production serves them over HTTPS, on 443.
SITE_SCHEME = "https"
SITE_PORT = ""

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Database

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": get_env_variable("POSTGRES_DB", "brain"),
        "USER": get_env_variable("POSTGRES_USER", "brain"),
        "PASSWORD": get_env_variable("POSTGRES_PASSWORD", "brain"),
        "HOST": get_env_variable("POSTGRES_HOST", "localhost"),
        "PORT": get_env_variable("POSTGRES_PORT", "5442"),
        # Under ASGI each request runs in a thread of its own, so persistent
        # connections (CONN_MAX_AGE) are never reused and pile up until
        # Postgres refuses clients. A pool per process reuses them and caps
        # the total: web workers x max_size stays well under max_connections.
        "CONN_MAX_AGE": 0,
        # With the pool, a connection is checked before it is handed out.
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {
            "pool": {"min_size": 1, "max_size": 10, "timeout": 10},
        },
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Password validation

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",  # noqa: E501
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# Internationalization

LANGUAGE_CODE = "en-us"
TIME_ZONE = get_env_variable("TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

# Static files and frontend build

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# The Vite build (frontend/dist). Its assets are served as static files and its
# index.html is served for every non-API route (see apps.core.views.spa).
FRONTEND_DIST_DIR = Path(
    get_env_variable("FRONTEND_DIST_DIR", str(BASE_DIR.parent / "frontend" / "dist"))
)
STATICFILES_DIRS = [FRONTEND_DIST_DIR] if FRONTEND_DIST_DIR.exists() else []

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    # No manifest: Vite already content-hashes its assets.
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

# User uploads. Never served from here: files go through views that check who
# asks (only the images of a published note are open to anyone, apps.public).
MEDIA_ROOT = Path(get_env_variable("STORAGE_PATH", str(BASE_DIR / "storage")))
MEDIA_URL = "/media/"

# Uploads captured as image or file items (apps.items.uploads). Anything over
# FILE_UPLOAD_MAX_MEMORY_SIZE (Django's default, 2.5 MB) is spooled to disk.
UPLOAD_MAX_SIZE = int(get_env_variable("UPLOAD_MAX_SIZE", str(50 * 1024 * 1024)))

# Database backups (apps.core.tasks.backup_database). Must live outside
# MEDIA_ROOT so dumps can never be served.
BACKUP_DIR = Path(get_env_variable("BACKUP_DIR", str(BASE_DIR / "backups")))
BACKUP_RETENTION = int(get_env_variable("BACKUP_RETENTION", "14"))

# Full exports (apps.exports): zips of everything a user has, kept for a while
# to be downloaded. Shared by api (serves them) and worker (builds them).
EXPORT_DIR = Path(get_env_variable("EXPORT_DIR", str(BASE_DIR / "exports")))
EXPORT_RETENTION_HOURS = int(get_env_variable("EXPORT_RETENTION_HOURS", "24"))

# Obsidian vault imports (apps.imports): the largest zip accepted. Cloudflare's
# free plan refuses requests over 100 MB anyway.
IMPORT_MAX_SIZE = int(get_env_variable("IMPORT_MAX_SIZE", str(100 * 1024 * 1024)))

# Telegram bot (apps.telegram): messages sent or forwarded to it land in the
# inbox of the account that connected the chat. Off without a token. The
# worker points the bot at TELEGRAM_WEBHOOK_URL when it starts.
TELEGRAM_BOT_TOKEN = get_env_variable("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_BOT_USERNAME = get_env_variable("TELEGRAM_BOT_USERNAME", "").lstrip("@")
TELEGRAM_WEBHOOK_URL = get_env_variable("TELEGRAM_WEBHOOK_URL", "")

# Semantic search (apps.items.embedder): the embedder container. Without it,
# search goes by words alone.
EMBEDDER_URL = get_env_variable("EMBEDDER_URL", "")

# Link previews (apps.items.tasks.fetch_link_preview). Private, loopback and
# link-local addresses are always refused unless explicitly allowed (tests).
LINK_PREVIEW_ALLOWED_PORTS = {80, 443}
LINK_PREVIEW_ALLOW_PRIVATE_IPS = False

# Auth

LOGIN_URL = "/login"

SESSION_COOKIE_AGE = 60 * 60 * 24 * 90  # 90 days: personal app, stay signed in
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"

# Django REST Framework

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
        # Personal API tokens (MCP, scripts): see apps.accounts.authentication.
        "apps.accounts.authentication.ApiTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 50,
}

# Redis: the Celery broker, and how open tabs hear about changes (apps.events).

REDIS_URL = get_env_variable("REDIS_URL", "redis://localhost:6389/0")

# Shared by every `api` process: rate limits (apps.accounts.limits). The short
# timeouts keep a sign-in from waiting on a Redis that doesn't answer.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
        "KEY_PREFIX": "brainbro",
        "OPTIONS": {"socket_connect_timeout": 1, "socket_timeout": 1},
    }
}

# What sits in front of the app, which decides where the client's address is
# read from: "cloudflare", "caddy", or "none" (the connection's own address).
# Anything else counts as "none", because trusting a header nobody overwrites
# would let clients write any address they like.
APP_PROXY = get_env_variable("APP_PROXY", "none").strip().lower()

# Celery

CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_TIME_LIMIT = 10 * 60
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BEAT_SCHEDULE = {
    "backup-database": {
        "task": "apps.core.tasks.backup_database",
        "schedule": crontab(hour=4, minute=0),
    },
    "delete-old-exports": {
        "task": "apps.exports.tasks.delete_old_exports",
        "schedule": crontab(minute=30),
    },
    "embed-items": {
        "task": "apps.items.tasks.embed_items",
        "schedule": 60.0,
        # A run missed while the worker was busy is covered by the next one.
        "options": {"expires": 50},
    },
    "delete-unused-note-images": {
        "task": "apps.items.tasks.delete_unused_note_images",
        "schedule": crontab(hour=4, minute=30),
    },
    "delete-unused-oauth-clients": {
        "task": "apps.accounts.tasks.delete_unused_oauth_clients",
        "schedule": crontab(hour=5, minute=0),
    },
}

# Admin

UNFOLD = {
    "SITE_TITLE": f"{APP_NAME} admin",
    "SITE_HEADER": APP_NAME,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {"format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "verbose"},
    },
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO"},
        "django.db.backends": {"handlers": ["console"], "level": "WARNING"},
        "apps": {"handlers": ["console"], "level": "INFO"},
    },
}
