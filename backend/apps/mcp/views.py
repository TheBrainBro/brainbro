import json
from urllib.parse import urlsplit

from django.http import HttpResponse, JsonResponse
from rest_framework.renderers import JSONRenderer
from rest_framework.views import APIView

from apps.accounts.authentication import ApiTokenAuthentication

from . import server


class McpView(APIView):
    """
    The Model Context Protocol endpoint (Streamable HTTP transport), so AI
    assistants can read and write the token owner's Brain.

    Stateless and without streams: each POST carries one JSON-RPC message and
    a request gets its response back as plain JSON. There is no session and
    no server-sent events, so GET (and DELETE) is 405.
    """

    # A personal API token only: no session, so no CSRF, and a missing or
    # wrong token is a 401 the client can act on.
    authentication_classes = [ApiTokenAuthentication]
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
        return JsonResponse(server.handle(request.user, message))


def rpc_error(code, text):
    return JsonResponse(
        {"jsonrpc": "2.0", "id": None, "error": {"code": code, "message": text}},
        status=400,
    )
