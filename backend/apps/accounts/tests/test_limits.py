import json
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client
from django.utils import timezone
from redis.exceptions import ConnectionError as RedisConnectionError
from rest_framework.test import APIClient, APIRequestFactory

from apps.accounts import limits
from apps.accounts.limits import LOGIN, TOO_MANY, client_ip
from apps.accounts.models import ApiToken, Invitation, OAuthClient

PING = {"jsonrpc": "2.0", "id": 1, "method": "ping"}


def sign_in(client, password, **headers):
    return client.post(
        "/api/auth/login/",
        json.dumps({"username": "alex", "password": password}),
        content_type="application/json",
        **headers,
    )


def bearer(key):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {key}")
    return client


def request_from(remote_addr="203.0.113.9", **headers):
    return APIRequestFactory().get("/", REMOTE_ADDR=remote_addr, headers=headers)


# The client's address


@pytest.mark.parametrize(
    "header",
    [{"CF-Connecting-IP": "198.51.100.1"}, {"X-Forwarded-For": "198.51.100.1"}],
)
def test_without_a_proxy_headers_are_ignored(settings, header):
    settings.APP_PROXY = "none"
    assert client_ip(request_from(**header)) == "203.0.113.9"


def test_behind_cloudflare_its_header_is_read_and_no_other(settings):
    settings.APP_PROXY = "cloudflare"
    request = request_from(
        **{"CF-Connecting-IP": "198.51.100.1", "X-Forwarded-For": "198.51.100.2"}
    )
    assert client_ip(request) == "198.51.100.1"
    assert client_ip(request_from(**{"X-Forwarded-For": "198.51.100.2"})) == (
        "203.0.113.9"
    )


def test_behind_caddy_the_last_forwarded_address_is_read(settings):
    settings.APP_PROXY = "caddy"
    request = request_from(**{"X-Forwarded-For": "1.2.3.4, 198.51.100.1"})
    assert client_ip(request) == "198.51.100.1"


@pytest.mark.parametrize("proxy", ["cloudflare", "caddy"])
def test_a_connection_from_the_internet_can_t_pick_its_address(settings, proxy):
    # It reached the port straight, not through the proxy.
    settings.APP_PROXY = proxy
    request = request_from(
        "9.9.9.9",
        **{"CF-Connecting-IP": "198.51.100.1", "X-Forwarded-For": "198.51.100.1"},
    )
    assert client_ip(request) == "9.9.9.9"


@pytest.mark.parametrize("proxy_addr", ["127.0.0.1", "172.18.0.5", "10.77.0.2", "::1"])
def test_the_proxy_on_this_machine_or_network_is_believed(settings, proxy_addr):
    settings.APP_PROXY = "cloudflare"
    request = request_from(proxy_addr, **{"CF-Connecting-IP": "198.51.100.1"})
    assert client_ip(request) == "198.51.100.1"


def test_a_header_that_is_not_an_address_falls_back_to_the_connection(settings):
    settings.APP_PROXY = "cloudflare"
    request = request_from(**{"CF-Connecting-IP": "not-an-ip"})
    assert client_ip(request) == "203.0.113.9"


def test_an_unknown_proxy_name_reads_no_header(settings):
    settings.APP_PROXY = "cloudflair"
    request = request_from(**{"CF-Connecting-IP": "198.51.100.1"})
    assert client_ip(request) == "203.0.113.9"


def test_ipv6_counts_by_network(settings):
    settings.APP_PROXY = "cloudflare"
    first = request_from(**{"CF-Connecting-IP": "2001:db8:1:2:aaaa::1"})
    second = request_from(**{"CF-Connecting-IP": "2001:db8:1:2:bbbb::2"})
    assert client_ip(first) == client_ip(second) == "2001:db8:1:2::/64"


def test_ipv4_written_as_ipv6_counts_as_ipv4(settings):
    settings.APP_PROXY = "cloudflare"
    request = request_from(**{"CF-Connecting-IP": "::ffff:198.51.100.1"})
    assert client_ip(request) == "198.51.100.1"


# Signing in


def test_the_sixth_failed_sign_in_is_refused(client, user):
    for _ in range(5):
        assert sign_in(client, "wrong").status_code == 400

    response = sign_in(client, "wrong")

    assert response.status_code == 429
    assert response.json() == {"detail": TOO_MANY}
    assert response["Retry-After"] == "60"


def test_once_blocked_even_the_right_password_waits(client, user):
    for _ in range(5):
        sign_in(client, "wrong")

    assert sign_in(client, "pw").status_code == 429


def test_good_sign_ins_use_up_no_attempts(user):
    for _ in range(8):
        assert sign_in(Client(), "pw").status_code == 200


def test_the_limit_is_per_address(settings, client, user):
    settings.APP_PROXY = "cloudflare"
    attacker = {"headers": {"CF-Connecting-IP": "198.51.100.1"}}
    someone_else = {"headers": {"CF-Connecting-IP": "198.51.100.2"}}
    for _ in range(6):
        sign_in(client, "wrong", **attacker)

    assert sign_in(client, "wrong", **attacker).status_code == 429
    assert sign_in(client, "pw", **someone_else).status_code == 200


def test_admin_sign_in_shares_the_limit(client, db):
    get_user_model().objects.create_user(username="boss", password="pw", is_staff=True)
    form = {"username": "boss", "password": "wrong"}
    for _ in range(5):
        assert client.post("/admin/login/", form).status_code == 200

    response = client.post("/admin/login/", form)

    assert response.status_code == 429
    assert response["Retry-After"] == "60"
    assert sign_in(client, "pw").status_code == 429


def test_a_good_admin_sign_in_uses_up_no_attempts(db):
    get_user_model().objects.create_user(username="boss", password="pw", is_staff=True)
    form = {"username": "boss", "password": "pw"}
    for _ in range(8):
        assert Client().post("/admin/login/", form).status_code == 302


def test_the_admin_sign_in_page_still_opens(client, db):
    assert client.get("/admin/login/").status_code == 200


# Invitation links


def test_invitation_links_are_limited(client, db):
    for _ in range(20):
        assert client.get("/api/auth/join/nope/").status_code == 404

    assert client.get("/api/auth/join/nope/").status_code == 429


def test_a_limited_invitation_says_nothing_about_usernames(client, user):
    for _ in range(20):
        client.get("/api/auth/join/nope/")

    response = client.post(
        "/api/auth/join/nope/",
        json.dumps({"username": "alex", "password": "a-long-new-pass"}),
        content_type="application/json",
    )

    assert response.status_code == 429
    assert response.json() == {"detail": TOO_MANY}


def test_a_valid_invitation_still_works(client, user):
    _, token = Invitation.issue(user, "Ana", timedelta(days=7))

    assert client.get(f"/api/auth/join/{token}/").json() == {"valid": True}


# OAuth


def register(client):
    return client.post(
        "/api/auth/oauth/register/",
        json.dumps(
            {
                "redirect_uris": ["https://example.com/back"],
                "token_endpoint_auth_method": "none",
            }
        ),
        content_type="application/json",
    )


def test_oauth_registration_is_limited(client, db):
    for _ in range(20):
        assert register(client).status_code == 201

    response = register(client)

    assert response.status_code == 429
    assert response.json()["error"] == "temporarily_unavailable"
    assert response["Retry-After"] == "60"
    assert OAuthClient.objects.count() == 20


def token_request(client, **body):
    return client.post(
        "/api/auth/oauth/token/", json.dumps(body), content_type="application/json"
    )


def test_failed_oauth_token_requests_are_limited(client, db):
    for _ in range(20):
        assert token_request(client, client_id="nope").status_code == 401

    response = token_request(client, client_id="nope")

    assert response.status_code == 429
    assert response.json()["error"] == "temporarily_unavailable"


def test_renewing_a_token_uses_up_no_attempts(client, user):
    app = OAuthClient.objects.create(name="App", redirect_uris=[], secret_hash="")
    token, _ = ApiToken.issue(user, "App", client=app)
    refresh = "first-refresh-token"
    token.refresh_hash = ApiToken.hash(refresh)
    token.save()

    for _ in range(25):
        response = token_request(
            client,
            client_id=str(app.id),
            grant_type="refresh_token",
            refresh_token=refresh,
        )
        assert response.status_code == 200
        refresh = response.json()["refresh_token"]


# Tokens


def post_mcp(client):
    return client.post("/api/mcp/", json.dumps(PING), content_type="application/json")


def test_unknown_api_tokens_are_limited(db):
    client = bearer("brainbro_nobody_issued_this")
    for _ in range(30):
        assert client.get("/api/items/").status_code == 403

    assert client.get("/api/items/").status_code == 429


def test_unknown_mcp_tokens_are_limited(db):
    client = bearer("brainbro_nobody_issued_this")
    for _ in range(30):
        assert post_mcp(client).status_code == 401

    response = post_mcp(client)

    assert response.status_code == 429
    assert response.json() == {"detail": TOO_MANY}


def test_a_valid_token_gets_through_from_a_blocked_address(user):
    _, key = ApiToken.issue(user, "Script")
    junk = bearer("brainbro_nobody_issued_this")
    for _ in range(31):
        junk.get("/api/items/")

    assert junk.get("/api/items/").status_code == 429
    assert bearer(key).get("/api/items/").status_code == 200


def test_expired_tokens_do_not_count(user):
    token, key = ApiToken.issue(user, "Old")
    token.expires_at = timezone.now() - timedelta(minutes=1)
    token.save()

    for _ in range(35):
        assert bearer(key).get("/api/items/").status_code == 403


def test_calling_mcp_without_a_token_does_not_count(db):
    client = APIClient()
    for _ in range(35):
        response = post_mcp(client)
        assert response.status_code == 401
        assert "resource_metadata" in response["WWW-Authenticate"]


# Without Redis


@pytest.fixture
def redis_down(monkeypatch):
    def fail(*args, **kwargs):
        raise RedisConnectionError

    monkeypatch.setattr(cache, "add", fail)
    monkeypatch.setattr(cache, "incr", fail)
    monkeypatch.setattr(cache, "decr", fail)


@pytest.fixture
def local_counts():
    limits.local_counts.clear()
    yield
    limits.local_counts.clear()


def test_without_redis_each_process_still_counts(
    client, user, redis_down, local_counts
):
    for _ in range(5):
        assert sign_in(client, "wrong").status_code == 400

    assert sign_in(client, "wrong").status_code == 429


def test_without_redis_good_sign_ins_still_work(user, redis_down, local_counts):
    for _ in range(8):
        assert sign_in(Client(), "pw").status_code == 200


def test_a_new_window_starts_from_zero():
    request = request_from()
    for _ in range(5):
        assert LOGIN.exceeded(request) is False
    assert LOGIN.exceeded(request) is True

    cache.delete(f"limit:login:{client_ip(request)}")

    assert LOGIN.exceeded(request) is False


def test_without_redis_a_refund_gives_the_attempt_back(redis_down, local_counts):
    request = request_from()
    for _ in range(5):
        assert LOGIN.exceeded(request) is False
    LOGIN.refund(request)

    assert LOGIN.exceeded(request) is False
    assert LOGIN.exceeded(request) is True
