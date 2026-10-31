"""
"Sign in to Brain" for AI assistants (ChatGPT, Claude, Grok…), as the MCP
authorization spec asks: OAuth 2.1 with PKCE, apps that register themselves,
and the metadata that lets them find all of it from the MCP URL alone.

1. The app calls the MCP endpoint without a token and gets a 401 pointing at
   the protected resource metadata, which names this server as the
   authorization server; its metadata lists the endpoints below.
2. It registers itself (`register`): a client id, and a secret if it asks.
3. It opens `/oauth/authorize` in the browser, a page of the app where the
   user, signed in, allows it (`authorize`). The app gets a one-time code.
4. It swaps the code for a token (`token`), an `ApiToken` with an hour of
   life and a refresh token, renewed the same way.

Connected apps show up with the personal tokens, and revoke the same way.
"""

import base64
import hashlib
import hmac
import secrets
from datetime import timedelta
from urllib.parse import urlencode, urlsplit

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .discovery import AUTH_METHODS, SCOPE, base_url, same_resource
from .models import ApiToken, AuthorizationCode, OAuthClient

ACCESS_LIFETIME = timedelta(hours=1)
CODE_LIFETIME = timedelta(minutes=10)


# Registration


def valid_redirect_uri(uri):
    """HTTPS, or plain HTTP to this same computer (desktop apps)."""
    parts = urlsplit(uri)
    if parts.fragment or not parts.netloc:
        return False
    local = parts.hostname in ("localhost", "127.0.0.1", "::1")
    return parts.scheme == "https" or (parts.scheme == "http" and local)


class RegistrationSerializer(serializers.Serializer):
    redirect_uris = serializers.ListField(
        child=serializers.CharField(max_length=2048), allow_empty=False, max_length=10
    )
    client_name = serializers.CharField(max_length=200, required=False)
    # RFC 7591's default is client_secret_basic.
    token_endpoint_auth_method = serializers.ChoiceField(
        choices=AUTH_METHODS, default="client_secret_basic"
    )


class RegisterView(APIView):
    """RFC 7591: an app registers itself, no account needed."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        payload = RegistrationSerializer(data=request.data)
        if not payload.is_valid():
            error = (
                "invalid_redirect_uri"
                if "redirect_uris" in payload.errors
                else "invalid_client_metadata"
            )
            return oauth_error(error, str(next(iter(payload.errors.values()))[0]))
        data = payload.validated_data
        if not all(valid_redirect_uri(uri) for uri in data["redirect_uris"]):
            return oauth_error(
                "invalid_redirect_uri", "Redirect URIs must be HTTPS or localhost."
            )
        method = data["token_endpoint_auth_method"]
        secret = secrets.token_urlsafe(32) if method != "none" else ""
        client = OAuthClient.objects.create(
            name=data.get("client_name") or "An AI assistant",
            redirect_uris=data["redirect_uris"],
            secret_hash=ApiToken.hash(secret) if secret else "",
        )
        registered = {
            "client_id": str(client.id),
            "client_id_issued_at": int(client.created_at.timestamp()),
            "client_name": client.name,
            "redirect_uris": client.redirect_uris,
            "token_endpoint_auth_method": method,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        }
        if secret:
            registered |= {"client_secret": secret, "client_secret_expires_at": 0}
        return no_store(Response(registered, status=status.HTTP_201_CREATED))


# Authorization


class AuthorizationRequest(serializers.Serializer):
    """The query the app opened `/oauth/authorize` with."""

    response_type = serializers.ChoiceField(choices=["code"])
    client_id = serializers.CharField(max_length=64)
    redirect_uri = serializers.CharField(max_length=2048)
    code_challenge = serializers.CharField(min_length=43, max_length=128)
    code_challenge_method = serializers.ChoiceField(choices=["S256"])
    state = serializers.CharField(max_length=2048, required=False)
    resource = serializers.CharField(max_length=2048, required=False)
    scope = serializers.CharField(max_length=2048, required=False)

    def validate(self, data):
        client = OAuthClient.objects.filter(id=parse_uuid(data["client_id"])).first()
        if client is None:
            raise serializers.ValidationError("This app isn't registered with Brain.")
        if data["redirect_uri"] not in client.redirect_uris:
            raise serializers.ValidationError(
                "This app gave an unknown return address."
            )
        request = self.context["request"]
        if "resource" in data and not same_resource(data["resource"], request):
            raise serializers.ValidationError("This app asked for another server.")
        data["client"] = client
        return data


class AuthorizeView(APIView):
    """
    Backs the `/oauth/authorize` page. `GET` (the app's query) says which app
    asks and where it goes back to; `POST` (the same, plus `allow`) answers
    with the address to send the browser to, carrying the code or the refusal.
    """

    authentication_classes = [SessionAuthentication]

    def get(self, request):
        data = self._request(request.query_params)
        return Response(
            {
                "client_name": data["client"].name,
                "redirect_host": urlsplit(data["redirect_uri"]).netloc,
            }
        )

    def post(self, request):
        data = self._request(request.data)
        answer = {"iss": base_url(request)}
        if "state" in data:
            answer["state"] = data["state"]
        if request.data.get("allow") is True:
            code = secrets.token_urlsafe(32)
            now = timezone.now()
            # Nobody swapped these: the sign-in was abandoned.
            AuthorizationCode.objects.filter(expires_at__lt=now).delete()
            AuthorizationCode.objects.create(
                owner=request.user,
                client=data["client"],
                code_hash=ApiToken.hash(code),
                redirect_uri=data["redirect_uri"],
                code_challenge=data["code_challenge"],
                expires_at=now + CODE_LIFETIME,
            )
            answer["code"] = code
        else:
            answer["error"] = "access_denied"
        separator = "&" if "?" in data["redirect_uri"] else "?"
        return Response(
            {"redirect_to": f"{data['redirect_uri']}{separator}{urlencode(answer)}"}
        )

    def _request(self, params):
        payload = AuthorizationRequest(
            data={key: params[key] for key in params if key != "allow"},
            context={"request": self.request},
        )
        payload.is_valid(raise_exception=True)
        return payload.validated_data


# Tokens


class TokenView(APIView):
    """RFC 6749: a code (with its PKCE verifier) or a refresh token for a token."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        data = request.data
        client = self._client(request)
        if client is None:
            return oauth_error("invalid_client", "Unknown client.", status=401)
        grant = data.get("grant_type")
        if grant == "authorization_code":
            return self._swap_code(request, client)
        if grant == "refresh_token":
            return self._refresh(request, client)
        return oauth_error("unsupported_grant_type", "Use a code or a refresh token.")

    def _client(self, request):
        """The client, checked against its secret when it has one."""
        client_id = request.data.get("client_id", "")
        secret = request.data.get("client_secret", "")
        header = request.headers.get("Authorization", "")
        if header.startswith("Basic "):
            try:
                decoded = base64.b64decode(header[6:]).decode()
            except ValueError:
                return None
            client_id, _, secret = decoded.partition(":")
        client = OAuthClient.objects.filter(id=parse_uuid(client_id)).first()
        if client is None:
            return None
        if client.secret_hash and not hmac.compare_digest(
            client.secret_hash, ApiToken.hash(secret)
        ):
            return None
        return client

    def _swap_code(self, request, client):
        data = request.data
        with transaction.atomic():
            code = (
                AuthorizationCode.objects.select_for_update()
                .select_related("owner")
                .filter(code_hash=ApiToken.hash(data.get("code", "")))
                .first()
            )
            if code is not None:
                # Once only, whatever happens next.
                code.delete()
        if (
            code is None
            or code.client_id != client.id
            or code.expires_at < timezone.now()
            or code.redirect_uri != data.get("redirect_uri")
            or not pkce_matches(data.get("code_verifier", ""), code.code_challenge)
        ):
            return oauth_error("invalid_grant", "The code is invalid or expired.")
        if "resource" in data and not same_resource(data["resource"], request):
            return oauth_error("invalid_target", "Tokens are only for Brain's MCP.")
        if not code.owner.is_active:
            return oauth_error("invalid_grant", "The account is disabled.")
        token = ApiToken(owner=code.owner, name=client.name[:100], client=client)
        return issued(token)

    def _refresh(self, request, client):
        key = request.data.get("refresh_token", "")
        token = (
            ApiToken.objects.select_related("owner")
            .filter(refresh_hash=ApiToken.hash(key), client=client)
            .first()
        )
        if token is None or not token.owner.is_active:
            return oauth_error("invalid_grant", "The refresh token is invalid.")
        return issued(token)


def issued(token):
    """
    A new access key and refresh token for `token` (saved), as a token
    response. Refreshing replaces both: the old ones stop working.
    """
    key, refresh = ApiToken.new_key(), secrets.token_urlsafe(32)
    token.set_key(key)
    token.refresh_hash = ApiToken.hash(refresh)
    token.expires_at = timezone.now() + ACCESS_LIFETIME
    token.save()
    return no_store(
        Response(
            {
                "access_token": key,
                "token_type": "Bearer",
                "expires_in": int(ACCESS_LIFETIME.total_seconds()),
                "refresh_token": refresh,
                "scope": SCOPE,
            }
        )
    )


def pkce_matches(verifier, challenge):
    digest = hashlib.sha256(verifier.encode()).digest()
    expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return bool(verifier) and hmac.compare_digest(expected, challenge)


def parse_uuid(value):
    """A client id that isn't even a UUID matches nothing."""
    try:
        return OAuthClient._meta.pk.to_python(value)
    except ValidationError:
        return None


def oauth_error(error, description, status=400):
    response = Response(
        {"error": error, "error_description": description}, status=status
    )
    return no_store(response)


def no_store(response):
    # Tokens and secrets are never cached (RFC 6749, 5.1).
    response["Cache-Control"] = "no-store"
    response["Pragma"] = "no-cache"
    return response
