"""
The largest request body the server takes, enforced before Django reads it.

Under ASGI, Django reads the whole body into a temporary file before any
middleware or view runs, and neither uvicorn nor Django caps files, so one
request of a few GB, even without signing in, would fill the disk while it
arrives. This wraps the app: a declared `Content-Length` over the limit is
refused right away, and a body sent without one stops being read when it
goes over.
"""

from django.conf import settings

TOO_LARGE = b"The request is too large."


def declared_length(scope):
    for name, value in scope["headers"]:
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


async def refuse(send):
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"text/plain; charset=utf-8"),
                (b"content-length", str(len(TOO_LARGE)).encode()),
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": TOO_LARGE})


def limit_body(app):
    async def limited(scope, receive, send):
        if scope["type"] != "http":
            return await app(scope, receive, send)
        limit = settings.REQUEST_MAX_SIZE
        length = declared_length(scope)
        if length is not None and length > limit:
            return await refuse(send)

        received = 0
        refused = False

        async def counted_receive():
            nonlocal received, refused
            if refused:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Django stops reading on a disconnect and answers nothing.
                    refused = True
                    await refuse(send)
                    return {"type": "http.disconnect"}
            return message

        return await app(scope, counted_receive, send)

    return limited
