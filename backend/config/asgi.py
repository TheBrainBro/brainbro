from django.core.asgi import get_asgi_application

from config.env import set_settings_module

set_settings_module()

application = get_asgi_application()
