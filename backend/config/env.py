import os
from typing import Optional

from django.core.exceptions import ImproperlyConfigured


def get_env_variable(
    key: str,
    default=None,
    raise_error: bool = True,
    error_message: Optional[str] = None,
) -> Optional[str]:
    """
    Get the environment variable or raise ImproperlyConfigured.
    :param key: The environment variable key.
    :param default: The default value.
    :param raise_error: Whether to raise an exception if the variable is not found.
    :param error_message: Optional. Error message to show.
    :return: The environment variable value.
    """
    try:
        return os.environ[key]
    except KeyError:
        if default is not None:
            return default
        if raise_error:
            raise ImproperlyConfigured(
                error_message or f"Environment variable {key} is not set."
            )
        return None


def set_settings_module():
    """Point DJANGO_SETTINGS_MODULE to config.settings.<ENVIRONMENT>."""
    environment = os.environ.get("ENVIRONMENT", "develop")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", f"config.settings.{environment}")
