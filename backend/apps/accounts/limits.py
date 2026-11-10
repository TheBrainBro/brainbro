"""
Limits on what can be guessed or flooded from outside: passwords, invitation
links, OAuth registration and credentials, and tokens nobody issued.

Attempts are counted per client address and per minute in the shared cache,
so every `api` process sees the same count. Without Redis there is no count
and nothing is refused: signing in matters more than the limit.
"""

import ipaddress
import logging
from dataclasses import dataclass

from django.conf import settings
from django.core.cache import cache
from redis.exceptions import RedisError
from rest_framework import exceptions, status

logger = logging.getLogger(__name__)

WINDOW = 60
TOO_MANY = "Too many attempts. Try again in a minute."


class TooManyAttempts(exceptions.APIException):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_detail = TOO_MANY
    default_code = "throttled"
    # DRF turns it into the Retry-After header.
    wait = WINDOW


def client_address(value):
    """
    The address to count `value` under, or None if it isn't one. A single
    IPv6 customer usually holds a whole /64, so that is what counts.
    """
    try:
        ip = ipaddress.ip_address(value.strip())
        if ip.version == 4:
            return str(ip)
        if ip.ipv4_mapped:
            return str(ip.ipv4_mapped)
        return str(ipaddress.ip_network(f"{ip}/64", strict=False))
    except ValueError:
        return None


def client_ip(request):
    """
    Who is asking. Only the header of the proxy this install says it has
    (`APP_PROXY`) is read: anywhere else, a client could write any address.
    Caddy discards what clients send and adds the real one last.
    """
    forwarded = ""
    if settings.APP_PROXY == "cloudflare":
        forwarded = request.headers.get("CF-Connecting-IP", "")
    elif settings.APP_PROXY == "caddy":
        forwarded = request.headers.get("X-Forwarded-For", "").rsplit(",", 1)[-1]
    return (
        client_address(forwarded)
        or client_address(request.META.get("REMOTE_ADDR", ""))
        or "unknown"
    )


@dataclass(frozen=True)
class Limit:
    name: str
    attempts: int

    def _key(self, request):
        return f"limit:{self.name}:{client_ip(request)}"

    def exceeded(self, request):
        """
        Counts an attempt and says whether it is one too many. It counts
        before the attempt runs, so a burst in parallel can't get ahead of it.
        """
        key = self._key(request)
        try:
            cache.add(key, 0, WINDOW)
            count = cache.incr(key)
            if count == 1:
                # If the key expired between those two lines, the increment
                # made a new one that would otherwise never expire.
                cache.touch(key, WINDOW)
        except ValueError:
            # It expired right before the increment: a new minute anyway.
            return False
        except RedisError:
            logger.warning("Rate limits are off: Redis is not answering.")
            return False
        return count > self.attempts

    def enforce(self, request):
        if self.exceeded(request):
            raise TooManyAttempts

    def refund(self, request):
        """Gives back an attempt that turned out fine."""
        try:
            cache.decr(self._key(request))
        except (ValueError, RedisError):
            pass


LOGIN = Limit("login", 5)
INVITATION = Limit("invitation", 20)
OAUTH_REGISTER = Limit("oauth-register", 20)
OAUTH_TOKEN = Limit("oauth-token", 20)
UNKNOWN_TOKEN = Limit("unknown-token", 30)
