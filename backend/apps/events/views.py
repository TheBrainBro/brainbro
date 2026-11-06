import redis.asyncio as aioredis
from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import close_old_connections
from django.http import JsonResponse, StreamingHttpResponse

from .changes import channel

# Cloudflare drops a connection after 100 s without a byte: a comment line
# goes out when nothing else has for this long.
HEARTBEAT_SECONDS = 25
# How long the browser waits before reconnecting when the stream drops.
RETRY_MS = 3000


async def stream(request):
    """
    `GET /api/events/`: server-sent events with what changes in the user's
    BrainBro (see `changes`), one `data:` line of JSON each, for as long as the
    tab keeps it open. Needs the session; the browser reconnects on its own.
    """
    user = await request.auser()
    # The stream needs no database: hand the connection back now, or it is
    # held for as long as the tab stays open.
    await sync_to_async(close_old_connections)()
    if not user.is_authenticated:
        return JsonResponse(
            {"detail": "Authentication credentials were not provided."}, status=403
        )
    response = StreamingHttpResponse(
        messages(user.pk), content_type="text/event-stream"
    )
    response["Cache-Control"] = "no-cache"
    # Proxies that buffer responses would hold the messages back.
    response["X-Accel-Buffering"] = "no"
    return response


async def messages(owner_id):
    client = aioredis.Redis.from_url(settings.REDIS_URL)
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(channel(owner_id))
        # Right away, so the browser knows it is connected.
        yield f"retry: {RETRY_MS}\n\n"
        while True:
            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=HEARTBEAT_SECONDS
            )
            if message is None:
                yield ": ping\n\n"
            else:
                yield f"data: {message['data'].decode()}\n\n"
    finally:
        await pubsub.aclose()
        await client.aclose()
