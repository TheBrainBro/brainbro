from django.apps import AppConfig


class EventsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.events"

    def ready(self):
        # Inline: the receivers import models, which can't load before the app
        # registry is ready.
        from . import receivers  # noqa: F401
