"""
Where MCP clients find "Sign in to Brain" (see `oauth`), from the MCP URL
alone. Kept apart from the views: authentication needs these URLs, and DRF
loads authentication while it starts.
"""

from urllib.parse import urlsplit

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_GET

# One scope: everything the MCP tools do.
SCOPE = "brain"
AUTH_METHODS = ("none", "client_secret_post", "client_secret_basic")


def base_url(request):
    """The issuer: this server's origin, as the client reached it."""
    return request.build_absolute_uri("/").rstrip("/")


def mcp_resource(request):
    """The MCP server's canonical URI (RFC 8707): no trailing slash."""
    return f"{base_url(request)}/api/mcp"


def resource_metadata_url(request):
    return f"{base_url(request)}/.well-known/oauth-protected-resource/api/mcp"


def same_resource(given, request):
    """`resource` as clients may write it: any case for scheme and host, `/`."""
    expected, given = urlsplit(mcp_resource(request)), urlsplit(given)
    return (
        given.scheme.lower() == expected.scheme
        and given.netloc.lower() == expected.netloc.lower()
        and given.path.rstrip("/") == expected.path
        and not given.query
        and not given.fragment
    )


@require_GET
def protected_resource(request):
    """RFC 9728: who issues tokens for the MCP endpoint."""
    return JsonResponse(
        {
            "resource": mcp_resource(request),
            "authorization_servers": [base_url(request)],
            "scopes_supported": [SCOPE],
            "bearer_methods_supported": ["header"],
            "resource_name": settings.APP_NAME,
        }
    )


@require_GET
def authorization_server(request):
    """RFC 8414: where to register, sign in and get tokens."""
    base = base_url(request)
    return JsonResponse(
        {
            "issuer": base,
            # A page of the frontend: the user has to be signed in to allow.
            "authorization_endpoint": f"{base}/oauth/authorize",
            "token_endpoint": f"{base}/api/auth/oauth/token/",
            "registration_endpoint": f"{base}/api/auth/oauth/register/",
            "scopes_supported": [SCOPE],
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": list(AUTH_METHODS),
            "authorization_response_iss_parameter_supported": True,
        }
    )
