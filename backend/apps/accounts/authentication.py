from datetime import timedelta

from django.utils import timezone
from rest_framework import authentication, exceptions

from .models import ApiToken

# `last_used_at` is only written again after this long, not on every request.
LAST_USED_PRECISION = timedelta(minutes=1)


class ApiTokenAuthentication(authentication.BaseAuthentication):
    """
    `Authorization: Bearer <token>` acts as the token's owner. No CSRF: the
    browser never sends the header on its own.
    """

    keyword = "Bearer"

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
        if token is None or not token.owner.is_active:
            raise exceptions.AuthenticationFailed("Invalid token.")
        now = timezone.now()
        if not token.last_used_at or now - token.last_used_at > LAST_USED_PRECISION:
            ApiToken.objects.filter(pk=token.pk).update(last_used_at=now)
        return token.owner, token

    def authenticate_header(self, request):
        return self.keyword
