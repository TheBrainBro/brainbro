"""
HTTP fetching for user-supplied URLs, hardened against SSRF.

Every connection is checked against the IP it actually reached (after DNS
resolution), so hostnames that resolve or rebind to private, loopback or
link-local addresses are refused, redirects included. Redirects are followed
by hand so each hop is validated. Bodies are size- and time-limited.
"""

import ipaddress
import time
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import requests
from django.conf import settings
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool

USER_AGENT = "Mozilla/5.0 (compatible; BrainBot/1.0; self-hosted link previews)"
TIMEOUT = (5, 10)  # connect, read (per chunk)
TOTAL_TIMEOUT = 20  # whole body download
MAX_REDIRECTS = 5
CHUNK_SIZE = 64 * 1024


class FetchError(Exception):
    """The URL can't be fetched and retrying won't help (4xx, too big...)."""


class BlockedURL(FetchError):
    """The URL points somewhere we refuse to connect to."""


class TransientFetchError(Exception):
    """Network trouble, timeouts, 5xx or 429: worth retrying later."""


@dataclass
class Fetched:
    url: str  # final URL, after redirects
    content_type: str  # media type only, lowercase
    charset: str | None
    content: bytes


def check_ip(ip):
    """Raise BlockedURL unless `ip` is a public unicast address."""
    if settings.LINK_PREVIEW_ALLOW_PRIVATE_IPS:
        return
    address = ipaddress.ip_address(ip.split("%", 1)[0])
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    if not address.is_global or address.is_multicast:
        raise BlockedURL(f"Refusing to connect to non-public address {address}")


def check_url(url):
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise BlockedURL(f"Unsupported URL: {url}")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if port not in settings.LINK_PREVIEW_ALLOWED_PORTS:
        raise BlockedURL(f"Port {port} is not allowed")
    try:
        check_ip(parts.hostname.strip("[]"))
    except ValueError:
        pass  # a hostname, checked once connected


class _PeerCheckMixin:
    def _new_conn(self):
        sock = super()._new_conn()
        try:
            check_ip(sock.getpeername()[0])
        except BlockedURL:
            sock.close()
            raise
        return sock


class _SafeHTTPConnection(_PeerCheckMixin, HTTPConnection):
    pass


class _SafeHTTPSConnection(_PeerCheckMixin, HTTPSConnection):
    pass


class _SafeHTTPConnectionPool(HTTPConnectionPool):
    ConnectionCls = _SafeHTTPConnection


class _SafeHTTPSConnectionPool(HTTPSConnectionPool):
    ConnectionCls = _SafeHTTPSConnection


class _SafeAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        super().init_poolmanager(*args, **kwargs)
        self.poolmanager.pool_classes_by_scheme = {
            "http": _SafeHTTPConnectionPool,
            "https": _SafeHTTPSConnectionPool,
        }


def _session():
    session = requests.Session()
    # Never route through environment proxies: the proxy would make the
    # connection and bypass the peer check.
    session.trust_env = False
    adapter = _SafeAdapter(max_retries=0)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def _read_limited(response, max_bytes):
    declared = response.headers.get("Content-Length", "")
    if declared.isdigit() and int(declared) > max_bytes:
        raise FetchError(f"Response too large ({declared} bytes)")
    deadline = time.monotonic() + TOTAL_TIMEOUT
    body = bytearray()
    for chunk in response.iter_content(CHUNK_SIZE):
        body += chunk
        if len(body) > max_bytes:
            raise FetchError(f"Response larger than {max_bytes} bytes")
        if time.monotonic() > deadline:
            raise TransientFetchError("Download took too long")
    return bytes(body)


def fetch(url, *, max_bytes, accept="*/*"):
    """GET `url` safely and return its body. See the module docstring."""
    headers = {"User-Agent": USER_AGENT, "Accept": accept}
    with _session() as session:
        for _ in range(MAX_REDIRECTS + 1):
            check_url(url)
            try:
                response = session.get(
                    url,
                    headers=headers,
                    timeout=TIMEOUT,
                    stream=True,
                    allow_redirects=False,
                )
            except (requests.ConnectionError, requests.Timeout) as exc:
                raise TransientFetchError(str(exc)) from exc
            except requests.RequestException as exc:
                raise FetchError(str(exc)) from exc

            with response:
                if response.is_redirect:
                    url = urljoin(url, response.headers["Location"])
                    continue
                code = response.status_code
                if code == 429 or code >= 500:
                    raise TransientFetchError(f"HTTP {code} from {url}")
                if code >= 400:
                    raise FetchError(f"HTTP {code} from {url}")
                try:
                    content = _read_limited(response, max_bytes)
                except (requests.ConnectionError, requests.Timeout) as exc:
                    raise TransientFetchError(str(exc)) from exc
                media_type, _, params = response.headers.get(
                    "Content-Type", ""
                ).partition(";")
                charset = None
                for param in params.split(";"):
                    key, _, value = param.strip().partition("=")
                    if key.lower() == "charset" and value:
                        charset = value.strip("\"'")
                return Fetched(
                    url=url,
                    content_type=media_type.strip().lower(),
                    charset=charset,
                    content=content,
                )
    raise FetchError("Too many redirects")
