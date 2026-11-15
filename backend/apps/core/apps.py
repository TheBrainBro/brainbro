from django.apps import AppConfig

# Registers the email checks.
from . import mail  # noqa: F401


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
