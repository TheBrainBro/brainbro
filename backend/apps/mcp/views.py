import json
from urllib.parse import urlsplit

from django.http import HttpResponse, JsonResponse
from rest_framework.renderers import JSONRenderer
from rest_framework.views import APIView

from apps.accounts.authentication import McpAuthentication
from apps.accounts.logos import token_logo
from apps.events.changes import collect
from apps.items.origin import Source, acting, app_name

from . import server, tools


class McpView(APIView):
    """
    The Model Context Protocol endpoint (Streamable HTTP transport), so AI
    assistants can read and write the token owner's BrainBro.

    Stateless and without streams: each POST carries one JSON-RPC message and
    a request gets its response back as plain JSON. There is no session and
    no server-sent events, so GET (and DELETE) is 405.
    """

    # A personal token or a connected app's: no session, so no CSRF, and a
    # missing or wrong token is a 401 that leads the client to sign in.
    authentication_classes = [McpAuthentication]
    renderer_classes = [JSONRenderer]
    http_method_names = ["post", "options"]

    def post(self, request):
        origin = request.headers.get("Origin")
        # Against DNS rebinding: a browser page may only call from this host.
        if origin and urlsplit(origin).netloc != request.get_host():
            return JsonResponse({"detail": "Origin not allowed."}, status=403)
        version = request.headers.get("MCP-Protocol-Version")
        if version and version not in server.PROTOCOL_VERSIONS:
            return rpc_error(server.INVALID_REQUEST, "Unsupported protocol version.")
        try:
            message = json.loads(request.body)
        except ValueError:
            return rpc_error(server.PARSE_ERROR, "Parse error.")
        # One message per POST: batches are not part of the protocol anymore.
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            return rpc_error(server.INVALID_REQUEST, "Invalid request.")
        if "id" not in message or "method" not in message:
            # A notification, or a response to us: nothing to answer.
            return HttpResponse(status=202)
        if message["method"] == "initialize":
            remember_client(request.auth, message.get("params"))
        # Open tabs name the assistant on what it changed, and so do items.
        name = app_name(request.auth)
        # The tools give whole addresses on this host, and check as the app does.
        logo = token_logo(request.auth)
        with (
            collect(by=name),
            acting(Source.MCP, by=name, logo=logo),
            tools.serving(request),
        ):
            return JsonResponse(
                server.handle(request.user, message, request.auth.permissions)
            )


def remember_client(token, params):
    """Keeps what the client calls itself, from the MCP handshake."""
    info = params.get("clientInfo") if isinstance(params, dict) else None
    if not isinstance(info, dict):
        return
    words = [info.get(key) for key in ("name", "title")]
    # Two fields of up to 200 characters, and the space between them.
    said = " ".join(word[:200] for word in words if isinstance(word, str))
    if said and said != token.client_app:
        token.client_app = said
        token.save(update_fields=["client_app", "updated_at"])


def rpc_error(code, text):
    return JsonResponse(
        {"jsonrpc": "2.0", "id": None, "error": {"code": code, "message": text}},
        status=400,
    )
