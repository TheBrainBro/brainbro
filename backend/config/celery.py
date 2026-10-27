from celery import Celery

from config.env import set_settings_module

set_settings_module()

app = Celery("brain")

# namespace="CELERY" means all celery-related settings keys use a CELERY_ prefix.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Load task modules from all registered Django app configs.
app.autodiscover_tasks()
