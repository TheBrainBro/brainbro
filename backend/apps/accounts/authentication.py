from datetime import timedelta

from django.utils import timezone
from rest_framework import authentication, exceptions

from .discovery import SCOPE, resource_metadata_url
from .models import ApiToken

# `last_used_at` is only written again after this long, not on every request.
LAST_USED_PRECISION = timedelta(minutes=1)


class ApiTokenAuthentication(authentication.BaseAuthentication):
    """
    `Authorization: Bearer <token>` acts as the token's owner. No CSRF: the
    browser never sends the header on its own.

    Apps connected by signing in (`ApiToken.client`) only get the MCP
    endpoint, which uses `McpAuthentication`; personal tokens get it all.
    """

    keyword = "Bearer"
    connected_apps = False

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.lower().encode():
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed("Invalid token header.")
        try:
            key = header[1].decode()
        except UnicodeError:
            raise exceptions.AuthenticationFailed("Invalid token.") from None
        token = (
            ApiToken.objects.select_related("owner")
            .filter(key_hash=ApiToken.hash(key))
            .first()
        )
        now = timezone.now()
        if (
            token is None
            or not token.owner.is_active
            or (token.client_id and not self.connected_apps)
            or (token.expires_at and token.expires_at < now)
        ):
            raise exceptions.AuthenticationFailed("Invalid token.")
        if not token.last_used_at or now - token.last_used_at > LAST_USED_PRECISION:
            ApiToken.objects.filter(pk=token.pk).update(last_used_at=now)
        return token.owner, token

    def authenticate_header(self, request):
        return self.keyword


class McpAuthentication(ApiTokenAuthentication):
    """
    Personal tokens and connected apps. A 401 points at the metadata that
    leads to "Sign in to BrainBro" (see `oauth`), as MCP clients expect.
    """

    connected_apps = True

    def authenticate_header(self, request):
        url = resource_metadata_url(request)
        return f'{self.keyword} resource_metadata="{url}", scope="{SCOPE}"'
