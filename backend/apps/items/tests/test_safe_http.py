import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from apps.items.safe_http import (
    BlockedURL,
    FetchError,
    TransientFetchError,
    check_ip,
    fetch,
)

PAGE = b"<html><head><title>Hi</title></head></html>"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        routes = {
            "/page": (200, {"Content-Type": "text/html; charset=utf-8"}, PAGE),
            "/redirect": (302, {"Location": "/page"}, b""),
            "/loop": (302, {"Location": "/loop"}, b""),
            "/big": (200, {"Content-Type": "text/html"}, b"x" * 5000),
            "/missing": (404, {}, b""),
            "/broken": (503, {}, b""),
        }
        code, headers, body = routes.get(self.path, (404, {}, b""))
        if self.path == "/elsewhere":
            code, headers = 302, {"Location": "http://localhost:1/page"}
        self.send_response(code)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def server():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}", httpd.server_port
    httpd.shutdown()


@pytest.fixture
def local(settings, server):
    """Allow the local test server, which is private on purpose."""
    base, port = server
    settings.LINK_PREVIEW_ALLOW_PRIVATE_IPS = True
    settings.LINK_PREVIEW_ALLOWED_PORTS = {port}
    return base


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "::1",
        "fe80::1%eth0",
        "fd00::1",
        "::ffff:127.0.0.1",
    ],
)
def test_check_ip_blocks_non_public_addresses(ip):
    with pytest.raises(BlockedURL):
        check_ip(ip)


@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
def test_check_ip_allows_public_addresses(ip):
    check_ip(ip)


def test_blocks_private_server_by_default(settings, server):
    base, port = server
    settings.LINK_PREVIEW_ALLOWED_PORTS = {port}
    with pytest.raises(BlockedURL):
        fetch(f"{base}/page", max_bytes=1000)


def test_blocks_hostnames_resolving_to_private_ips(settings, server):
    # The DNS answer is what gets checked, not the hostname.
    _, port = server
    settings.LINK_PREVIEW_ALLOWED_PORTS = {port}
    with pytest.raises(BlockedURL):
        fetch(f"http://localhost:{port}/page", max_bytes=1000)


@pytest.mark.parametrize(
    "url",
    ["file:///etc/passwd", "gopher://example.com", "http://example.com:6379/"],
)
def test_blocks_unsupported_schemes_and_ports(url):
    with pytest.raises(BlockedURL):
        fetch(url, max_bytes=1000)


def test_fetches_and_follows_redirects(local):
    fetched = fetch(f"{local}/redirect", max_bytes=1000)
    assert fetched.url == f"{local}/page"
    assert (fetched.content_type, fetched.charset) == ("text/html", "utf-8")
    assert fetched.content == PAGE


def test_redirects_are_validated(local):
    with pytest.raises(BlockedURL):
        fetch(f"{local}/elsewhere", max_bytes=1000)


def test_redirect_loops_stop(local):
    with pytest.raises(FetchError, match="redirects"):
        fetch(f"{local}/loop", max_bytes=1000)


def test_size_limit(local):
    with pytest.raises(FetchError, match="too large"):
        fetch(f"{local}/big", max_bytes=1000)


def test_client_errors_are_final_and_server_errors_transient(local):
    with pytest.raises(FetchError):
        fetch(f"{local}/missing", max_bytes=1000)
    with pytest.raises(TransientFetchError):
        fetch(f"{local}/broken", max_bytes=1000)
