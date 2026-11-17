"""
Settings, Server, Public address: where people outside reach this server,
for admins only (apps.core.public_address). Saving it changes the links that
go out from then on; those already sent keep the address they were made with,
and still open while that address serves the app.
"""

from urllib.parse import urlsplit

from django.conf import settings
from django.db.models import Q
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from apps.public.models import Site
from apps.public.sites import is_ip_address, normalize_hostname
from apps.telegram import bot
from apps.telegram.tasks import register_webhook, webhook_url

from . import public_address

INVALID = "Enter the address people open BrainBro on, like https://brain.example.com."


def normalize(value):
    """
    `HTTPS://Brain.Example.com/` (or `brain.example.com`) as
    `https://brain.example.com`; "" stays "".
    Raises ValidationError for anything but a scheme, a host and a port.
    """
    value = value.strip().rstrip("/")
    if not value:
        return ""
    # `brain.example.com` alone: a public address is HTTPS nearly always.
    if "://" not in value:
        value = f"https://{value}"
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        raise serializers.ValidationError(INVALID) from None
    hostname = parts.hostname or ""
    if (
        parts.scheme.lower() not in ("http", "https")
        or parts.username is not None
        or parts.path
        or parts.query
        or parts.fragment
        or not hostname
    ):
        raise serializers.ValidationError(INVALID)
    if is_ip_address(hostname):
        host = f"[{hostname}]" if ":" in hostname else hostname
    else:
        host = normalize_hostname(hostname)
        if not host:
            raise serializers.ValidationError(INVALID)
    if port is not None:
        host = f"{host}:{port}"
    return f"{parts.scheme.lower()}://{host}"


class PublicAddressSerializer(serializers.Serializer):
    public_url = serializers.CharField(max_length=300, allow_blank=True)

    def validate_public_url(self, value):
        value = normalize(value)
        hostname = urlsplit(value).hostname
        if not hostname:
            return value
        if settings.EMBED_HOSTNAME and hostname == settings.EMBED_HOSTNAME:
            raise serializers.ValidationError(
                "This is the address of embedded posts, not BrainBro's."
            )
        if Site.objects.filter(
            Q(hostname=hostname) | Q(pending_hostname=hostname)
        ).exists():
            raise serializers.ValidationError("A blog uses this domain.")
        return value


@api_view(["GET", "PUT"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAdminUser])
def public_address_view(request):
    """
    `GET` says the public address, `{"public_url"}` ("" without one).
    `PUT {"public_url"}` saves it; "" goes back to the request's address.
    """
    if request.method == "PUT":
        payload = PublicAddressSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        before = webhook_url()
        public_address.save(payload.validated_data["public_url"])
        # The bot's messages now come in at the new address.
        if bot.configured() and webhook_url() and webhook_url() != before:
            register_webhook.delay()
    return Response({"public_url": public_address.saved()})
