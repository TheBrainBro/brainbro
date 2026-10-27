from django.core.wsgi import get_wsgi_application

from config.env import set_settings_module

set_settings_module()

application = get_wsgi_application()
