from django.core.asgi import get_asgi_application

from config.env import set_settings_module

set_settings_module()

django_application = get_asgi_application()

# After setup: it loads models.
from apps.collab.asgi import websocket  # noqa: E402


async def application(scope, receive, send):
    """Django for HTTP; WebSockets (live note editing) go to `apps.collab`."""
    if scope["type"] == "websocket":
        await websocket(scope, receive, send)
    else:
        await django_application(scope, receive, send)
