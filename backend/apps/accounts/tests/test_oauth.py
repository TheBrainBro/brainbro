import base64
import hashlib
import json
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from django.test import Client
from django.utils import timezone

from apps.accounts.models import ApiToken, AuthorizationCode, OAuthClient

REDIRECT = "https://chatgpt.com/connector/oauth/callback"
VERIFIER = "a-long-random-pkce-verifier-from-the-client-0123456789"
PING = {"jsonrpc": "2.0", "id": 1, "method": "ping"}


def challenge(verifier):
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


@pytest.fixture
def anonymous():
    return Client(enforce_csrf_checks=True)


@pytest.fixture
def browser(user):
    """The user's browser, signed in to BrainBro."""
    client = Client()
    client.force_login(user)
    return client


def register(client, **metadata):
    body = {
        "redirect_uris": [REDIRECT],
        "client_name": "ChatGPT",
        "token_endpoint_auth_method": "none",
    } | metadata
    return client.post(
        "/api/auth/oauth/register/", json.dumps(body), content_type="application/json"
    )


def authorization(client_id, **params):
    return {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT,
        "code_challenge": challenge(VERIFIER),
        "code_challenge_method": "S256",
        "state": "xyz",
        "resource": "http://testserver/api/mcp",
        "scope": "brainbro",
    } | params


def allow(browser, client_id, **params):
    """The user presses Allow; returns the query the app gets back."""
    response = browser.post(
        "/api/auth/oauth/authorize/",
        {**authorization(client_id, **params), "allow": True},
        content_type="application/json",
    )
    assert response.status_code == 200, response.json()
    redirect = urlsplit(response.json()["redirect_to"])
    assert f"{redirect.scheme}://{redirect.netloc}{redirect.path}" == REDIRECT
    return {key: value[0] for key, value in parse_qs(redirect.query).items()}


def swap(client, client_id, code, verifier=VERIFIER, headers=None, **extra):
    return client.post(
        "/api/auth/oauth/token/",
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT,
            "client_id": client_id,
            "code_verifier": verifier,
            "resource": "http://testserver/api/mcp",
        }
        | extra,
        headers=headers,
    )


def connect(anonymous, browser):
    """The whole sign-in: returns the token response."""
    client_id = register(anonymous).json()["client_id"]
    code = allow(browser, client_id)["code"]
    response = swap(anonymous, client_id, code)
    assert response.status_code == 200, response.json()
    return client_id, response.json()


def mcp(key, path="/api/mcp"):
    return Client().post(
        path,
        json.dumps(PING),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {key}",
    )


# Discovery


@pytest.mark.django_db
@pytest.mark.parametrize(
    "path",
    [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/api/mcp",
        "/.well-known/oauth-protected-resource/api/mcp/",
    ],
)
def test_the_mcp_endpoint_names_its_authorization_server(anonymous, path):
    metadata = anonymous.get(path).json()
    assert metadata["resource"] == "http://testserver/api/mcp"
    assert metadata["authorization_servers"] == ["http://testserver"]


@pytest.mark.django_db
def test_the_authorization_server_lists_its_endpoints(anonymous):
    metadata = anonymous.get("/.well-known/oauth-authorization-server").json()

    assert metadata["issuer"] == "http://testserver"
    assert metadata["authorization_endpoint"] == "http://testserver/oauth/authorize"
    assert metadata["code_challenge_methods_supported"] == ["S256"]
    for endpoint in ("token_endpoint", "registration_endpoint"):
        # There, and answering in OAuth terms.
        path = urlsplit(metadata[endpoint]).path
        assert "error" in anonymous.post(path, {}).json()


# Registration


@pytest.mark.django_db
def test_an_app_registers_itself(anonymous):
    response = register(anonymous)

    assert response.status_code == 201
    registered = response.json()
    assert registered["redirect_uris"] == [REDIRECT]
    assert "client_secret" not in registered
    assert OAuthClient.objects.get(id=registered["client_id"]).name == "ChatGPT"


@pytest.mark.django_db
def test_an_app_can_ask_for_a_secret(anonymous):
    registered = register(anonymous, token_endpoint_auth_method="client_secret_post")
    secret = registered.json()["client_secret"]
    client = OAuthClient.objects.get()
    assert client.secret_hash == ApiToken.hash(secret)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "uris", [["http://evil.example/callback"], ["https://a.b/c#frag"], []]
)
def test_return_addresses_must_be_https_or_local(anonymous, uris):
    response = register(anonymous, redirect_uris=uris)
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_redirect_uri"


@pytest.mark.django_db
def test_local_apps_can_come_back_over_http(anonymous):
    response = register(anonymous, redirect_uris=["http://localhost:33418/callback"])
    assert response.status_code == 201


# Authorization


def test_the_page_shows_who_asks_and_where_it_goes_back(anonymous, browser):
    client_id = register(anonymous).json()["client_id"]

    response = browser.get("/api/auth/oauth/authorize/", authorization(client_id))

    assert response.json() == {
        "client_name": "ChatGPT",
        "redirect_host": "chatgpt.com",
    }


@pytest.mark.django_db
def test_allowing_needs_the_user_signed_in(anonymous):
    client_id = register(anonymous).json()["client_id"]
    response = anonymous.get("/api/auth/oauth/authorize/", authorization(client_id))
    assert response.status_code == 403


@pytest.mark.parametrize(
    "params",
    [
        {"redirect_uri": "https://evil.example/callback"},
        {"client_id": "00000000-0000-0000-0000-000000000000"},
        {"client_id": "not-a-uuid"},
        {"code_challenge_method": "plain"},
        {"code_challenge": ""},
        {"resource": "https://other.example/mcp"},
    ],
)
def test_bad_requests_are_refused_without_going_back(anonymous, browser, params):
    client_id = register(anonymous).json()["client_id"]
    response = browser.get(
        "/api/auth/oauth/authorize/", authorization(client_id) | params
    )
    assert response.status_code == 400


def test_allowing_sends_a_code_back_with_the_state(anonymous, browser):
    client_id = register(anonymous).json()["client_id"]

    answer = allow(browser, client_id)

    assert answer["state"] == "xyz"
    assert answer["iss"] == "http://testserver"
    assert AuthorizationCode.objects.get().code_hash == ApiToken.hash(answer["code"])


def test_cancelling_tells_the_app(anonymous, browser):
    client_id = register(anonymous).json()["client_id"]
    response = browser.post(
        "/api/auth/oauth/authorize/",
        {**authorization(client_id), "allow": False},
        content_type="application/json",
    )
    answer = parse_qs(urlsplit(response.json()["redirect_to"]).query)
    assert answer["error"] == ["access_denied"]
    assert not AuthorizationCode.objects.exists()


# Tokens


def test_the_code_becomes_a_token_for_the_mcp_server(anonymous, browser, user):
    _, tokens = connect(anonymous, browser)

    assert tokens["token_type"] == "Bearer"
    assert tokens["expires_in"] == 3600
    token = ApiToken.objects.get(owner=user)
    assert (token.name, token.client.name) == ("ChatGPT", "ChatGPT")
    assert mcp(tokens["access_token"]).json()["result"] == {}
    assert mcp(tokens["access_token"], "/api/mcp/").status_code == 200


def test_token_responses_are_never_cached(anonymous, browser):
    client_id = register(anonymous).json()["client_id"]
    code = allow(browser, client_id)["code"]
    response = swap(anonymous, client_id, code)
    assert response["Cache-Control"] == "no-store"


def test_a_connected_app_only_gets_the_mcp_server(anonymous, browser):
    _, tokens = connect(anonymous, browser)
    response = Client().get(
        "/api/items/", HTTP_AUTHORIZATION=f"Bearer {tokens['access_token']}"
    )
    assert response.status_code == 403


def test_a_code_works_once(anonymous, browser):
    client_id = register(anonymous).json()["client_id"]
    code = allow(browser, client_id)["code"]

    assert swap(anonymous, client_id, code).status_code == 200
    response = swap(anonymous, client_id, code)

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_grant"


def test_the_pkce_verifier_must_match(anonymous, browser):
    client_id = register(anonymous).json()["client_id"]
    code = allow(browser, client_id)["code"]
    response = swap(anonymous, client_id, code, verifier="someone-else-s-verifier")
    assert response.json()["error"] == "invalid_grant"
    assert not ApiToken.objects.exists()


def test_a_code_is_for_the_app_that_asked(anonymous, browser):
    client_id = register(anonymous).json()["client_id"]
    other_id = register(anonymous).json()["client_id"]
    code = allow(browser, client_id)["code"]
    assert swap(anonymous, other_id, code).json()["error"] == "invalid_grant"


def test_an_expired_code_is_refused(anonymous, browser):
    client_id = register(anonymous).json()["client_id"]
    code = allow(browser, client_id)["code"]
    AuthorizationCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert swap(anonymous, client_id, code).json()["error"] == "invalid_grant"


def test_tokens_are_only_for_this_mcp_server(anonymous, browser):
    client_id = register(anonymous).json()["client_id"]
    code = allow(browser, client_id)["code"]
    response = swap(anonymous, client_id, code, resource="https://other.example/mcp")
    assert response.json()["error"] == "invalid_target"


def test_an_app_with_a_secret_must_send_it(anonymous, browser):
    registered = register(anonymous, token_endpoint_auth_method="client_secret_basic")
    client_id, secret = (
        registered.json()["client_id"],
        registered.json()["client_secret"],
    )
    code = allow(browser, client_id)["code"]

    assert swap(anonymous, client_id, code).status_code == 401
    code = allow(browser, client_id)["code"]
    basic = base64.b64encode(f"{client_id}:{secret}".encode()).decode()
    response = swap(anonymous, "", code, headers={"Authorization": f"Basic {basic}"})

    assert response.status_code == 200


def test_an_expired_access_token_is_refused(anonymous, browser):
    _, tokens = connect(anonymous, browser)
    ApiToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert mcp(tokens["access_token"]).status_code == 401


def test_refreshing_replaces_both_tokens(anonymous, browser):
    client_id, tokens = connect(anonymous, browser)

    response = anonymous.post(
        "/api/auth/oauth/token/",
        {
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
            "client_id": client_id,
        },
    )

    fresh = response.json()
    assert response.status_code == 200
    assert mcp(fresh["access_token"]).status_code == 200
    assert mcp(tokens["access_token"]).status_code == 401
    again = anonymous.post(
        "/api/auth/oauth/token/",
        {
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
            "client_id": client_id,
        },
    )
    assert again.json()["error"] == "invalid_grant"
    assert ApiToken.objects.count() == 1


def test_revoking_a_connected_app_disconnects_it(anonymous, browser):
    client_id, tokens = connect(anonymous, browser)
    token = ApiToken.objects.get()

    listed = browser.get("/api/auth/tokens/").json()
    browser.delete(f"/api/auth/tokens/{token.id}/")

    assert listed[0]["connected_app"] is True
    assert mcp(tokens["access_token"]).status_code == 401
    refreshed = anonymous.post(
        "/api/auth/oauth/token/",
        {
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
            "client_id": client_id,
        },
    )
    assert refreshed.json()["error"] == "invalid_grant"
