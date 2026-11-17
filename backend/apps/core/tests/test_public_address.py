import re

import pytest
from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.test import Client, RequestFactory

from apps.core import public_address
from apps.core.address_views import normalize
from apps.items.models import Collection, Item
from apps.public.models import Site
from apps.public.publishing import publish
from apps.public.sites import SiteMiddleware
from apps.telegram.tasks import webhook_url

URL = "/api/server/address/"
PUBLIC = "https://brain.example.com"
INDEX = "<html><head><title>BrainBro</title></head><body></body></html>"


@pytest.fixture
def admin_user(db):
    return get_user_model().objects.create_user(
        username="admin", password="pw", is_staff=True, email="admin@example.com"
    )


@pytest.fixture
def admin(admin_user):
    client = Client()
    client.force_login(admin_user)
    return client


@pytest.fixture
def email_on(settings):
    settings.EMAIL_PROVIDER = "mailgun"
    settings.MAILGUN_API_KEY = "key-123"
    settings.MAILGUN_DOMAIN = "mail.example.com"
    settings.MAILGUN_REGION = "us"
    settings.EMAIL_FROM = ""


@pytest.fixture
def no_webhook(settings):
    settings.TELEGRAM_WEBHOOK_URL = ""


def put(client, value):
    return client.put(URL, {"public_url": value}, content_type="application/json")


# The setting


def test_only_admins_set_it(user):
    client = Client()
    client.force_login(user)

    assert client.get(URL).status_code == 403
    assert put(client, PUBLIC).status_code == 403
    assert Client().get(URL).status_code in (401, 403)


def test_an_admin_saves_it_and_clears_it(admin):
    assert admin.get(URL).json() == {"public_url": ""}

    response = put(admin, "HTTPS://Brain.Example.com/")

    assert response.status_code == 200
    assert response.json() == {"public_url": PUBLIC}
    assert public_address.saved() == PUBLIC
    assert put(admin, "").json() == {"public_url": ""}
    assert public_address.saved() == ""


@pytest.mark.parametrize(
    ("value", "saved"),
    [
        ("brain.example.com", PUBLIC),
        ("  https://brain.example.com/  ", PUBLIC),
        ("http://umbrel.local:8420", "http://umbrel.local:8420"),
        ("http://192.168.1.20:8420", "http://192.168.1.20:8420"),
        ("http://[fd00::1]:8420", "http://[fd00::1]:8420"),
        ("", ""),
    ],
)
def test_what_it_can_be(value, saved):
    assert normalize(value) == saved


@pytest.mark.parametrize(
    "value",
    [
        "ftp://brain.example.com",
        "https://brain.example.com/brainbro",
        "https://brain.example.com/?a=1",
        "https://user@brain.example.com",
        "https://brain.example.com:99999",
        "https://localhost",
        "https://",
    ],
)
def test_what_it_cant_be(admin, value):
    response = put(admin, value)

    assert response.status_code == 400
    assert "public_url" in response.json()


def test_it_cant_be_a_blogs_domain(admin, user):
    Site.objects.create(owner=user, hostname="blog.example.com")

    response = put(admin, "https://blog.example.com")

    assert response.status_code == 400
    assert response.json() == {"public_url": ["A blog uses this domain."]}


def test_it_cant_be_the_embed_host(admin, settings):
    settings.EMBED_HOSTNAME = "embed.example.com"

    assert put(admin, "https://embed.example.com").status_code == 400


def test_the_session_says_it(api, db):
    assert api.get("/api/auth/session/").json()["public_url"] == ""

    public_address.save(PUBLIC)

    assert api.get("/api/auth/session/").json()["public_url"] == PUBLIC


# Its host serves the app


def health(host):
    return Client().get("/api/health/", HTTP_HOST=host).status_code


def test_its_host_serves_the_app(db):
    assert health("brain.example.com") == 400

    public_address.save(PUBLIC)

    assert health("brain.example.com") == 200
    assert health("other.example.com") == 400


def test_a_blog_cant_take_its_domain(api, user):
    public_address.save(PUBLIC)
    writing = Collection.objects.create(owner=user, name="Writing")

    response = api.post(
        "/api/sites/",
        {"hostname": "brain.example.com", "collection": str(writing.id)},
        format="json",
    )

    assert response.status_code == 400
    assert response.json() == {"hostname": ["This is BrainBro's own address."]}


def seen_by_the_app(host, forwarded_proto=None):
    """The request as the views see it, after SiteMiddleware."""
    headers = {"HTTP_HOST": host}
    if forwarded_proto:
        headers["HTTP_X_FORWARDED_PROTO"] = forwarded_proto
    seen = {}

    def view(request):
        seen["request"] = request
        return HttpResponse()

    SiteMiddleware(view)(RequestFactory().get("/", **headers))
    return seen["request"]


def test_its_host_trusts_the_proxy_when_it_is_https(db, settings):
    settings.SECURE_PROXY_SSL_HEADER = None
    settings.APP_HOSTS = ["umbrel.local"]
    public_address.save(PUBLIC)

    assert seen_by_the_app("brain.example.com", "https").is_secure()
    assert seen_by_the_app("brain.example.com", "https,http").is_secure()
    assert not seen_by_the_app("brain.example.com").is_secure()
    # Any other host keeps the connection's own scheme.
    assert not seen_by_the_app("umbrel.local", "https").is_secure()


def test_a_plain_http_address_trusts_no_proxy(db, settings):
    settings.SECURE_PROXY_SSL_HEADER = None
    public_address.save("http://brain.example.com")

    assert not seen_by_the_app("brain.example.com", "https").is_secure()


def test_sign_in_through_a_tunnel_passes_the_csrf_check(user, settings):
    """The Umbrel app runs without APP_HTTPS: the tunnel's origin is https://."""
    settings.SECURE_PROXY_SSL_HEADER = None
    public_address.save(PUBLIC)
    client = Client(
        enforce_csrf_checks=True,
        HTTP_HOST="brain.example.com",
        HTTP_X_FORWARDED_PROTO="https",
    )
    client.get("/api/auth/session/")
    token = client.cookies["csrftoken"].value

    response = client.post(
        "/api/auth/login/",
        {"username": "alex", "password": "pw"},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
        HTTP_ORIGIN=PUBLIC,
    )

    assert response.status_code == 200
    assert response.json()["authenticated"] is True


# Links that leave the instance


def test_invitations_link_to_it(admin, email_on, mailoutbox):
    public_address.save(PUBLIC)

    response = admin.post(
        "/api/auth/invitations/",
        {"note": "Ana", "email": "ana@example.com"},
        content_type="application/json",
    )

    url = response.json()["url"]
    assert url.startswith(f"{PUBLIC}/join/")
    [message] = mailoutbox
    assert url in message.body
    assert "on brain.example.com:" in message.body


def test_without_it_links_use_the_request_address(admin):
    response = admin.post(
        "/api/auth/invitations/", {"note": "Ana"}, content_type="application/json"
    )

    assert response.json()["url"].startswith("http://testserver/join/")


def test_password_reset_emails_link_to_it(db, email_on, mailoutbox):
    get_user_model().objects.create_user(
        username="alex", email="alex@example.com", password="pw"
    )
    public_address.save(PUBLIC)

    Client().post(
        "/api/auth/password-reset/",
        {"email": "alex@example.com"},
        content_type="application/json",
    )

    [message] = mailoutbox
    assert re.search(rf"{PUBLIC}/reset-password/\S+/\S+", message.body)


def test_public_pages_name_it_as_their_address(client, user, settings, tmp_path):
    (tmp_path / "index.html").write_text(INDEX)
    settings.FRONTEND_DIST_DIR = tmp_path
    settings.EMBED_URL = ""
    publish(Item.objects.create(owner=user, kind=Item.Kind.NOTE, title="Trip plan"))
    public_address.save(PUBLIC)

    html = client.get("/@author/trip-plan").content.decode()

    assert f'<meta property="og:url" content="{PUBLIC}/@author/trip-plan" />' in html


def test_blogs_cname_points_at_it(api, user, settings):
    settings.SITE_CNAME_TARGET = ""
    public_address.save("https://brain.example.com:8443")
    writing = Collection.objects.create(owner=user, name="Writing")

    response = api.post(
        "/api/sites/",
        {"hostname": "blog.example.com", "collection": str(writing.id)},
        format="json",
    )

    assert {
        "type": "CNAME",
        "name": "blog.example.com",
        "value": "brain.example.com",
    } in response.json()["records"]


# The Telegram webhook


def test_the_webhook_follows_an_https_address(db, no_webhook):
    assert webhook_url() == ""

    public_address.save("http://brain.example.com")
    assert webhook_url() == ""

    public_address.save(PUBLIC)
    assert webhook_url() == f"{PUBLIC}/api/telegram/webhook/"


def test_the_environment_webhook_wins(db, settings):
    settings.TELEGRAM_WEBHOOK_URL = "https://hook.example.com/api/telegram/webhook/"
    public_address.save(PUBLIC)

    assert webhook_url() == "https://hook.example.com/api/telegram/webhook/"


def test_saving_it_points_the_bot_there(admin, no_webhook, settings, monkeypatch):
    settings.TELEGRAM_BOT_TOKEN = "123:abc"
    settings.TELEGRAM_BOT_USERNAME = "brainbro_bot"
    calls = []
    monkeypatch.setattr(
        "apps.telegram.bot.call", lambda method, **params: calls.append(params)
    )

    put(admin, PUBLIC)
    put(admin, PUBLIC)

    assert [params["url"] for params in calls] == [f"{PUBLIC}/api/telegram/webhook/"]
