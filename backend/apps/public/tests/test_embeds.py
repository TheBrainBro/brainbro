import re

import pytest

from apps.public import embeds

EMBED = "embed.testserver"


@pytest.fixture(autouse=True)
def build(settings, tmp_path):
    (tmp_path / "index.html").write_text(
        "<html><head><title>BrainBro</title></head><body></body></html>"
    )
    settings.FRONTEND_DIST_DIR = tmp_path


def test_the_embed_host_shows_a_post_from_x(client, db):
    response = client.get("/x/20", HTTP_HOST=EMBED)

    html = response.content.decode()
    assert response.status_code == 200
    assert 'href="https://twitter.com/i/status/20"' in html
    assert 'src="https://platform.x.com/widgets.js"' in html
    assert '<meta name="twitter:dnt" content="on"' in html
    assert 'data-dnt="true"' in html


def test_any_page_may_frame_a_post(client, db):
    response = client.get("/x/20", HTTP_HOST=EMBED)

    assert "X-Frame-Options" not in response


def test_a_post_s_page_runs_no_inline_script(client, db):
    html = client.get("/x/20", HTTP_HOST=EMBED).content.decode()

    for attributes in re.findall(r"<script\b([^>]*)>", html):
        assert "src=" in attributes


@pytest.mark.parametrize(
    "path", ["/x/abc", "/x/20/", "/inbox", "/api/items/", "/admin/"]
)
def test_nothing_else_is_served_from_the_embed_host(client, db, path):
    assert client.get(path, HTTP_HOST=EMBED).status_code == 404


def test_the_embed_host_never_sees_the_session(user, client, monkeypatch):
    client.force_login(user)
    seen = {}
    original = embeds.render

    def spy(request, *args, **kwargs):
        seen["cookies"] = dict(request.COOKIES)
        seen["user"] = request.user.is_authenticated
        return original(request, *args, **kwargs)

    monkeypatch.setattr(embeds, "render", spy)

    client.get("/x/20", HTTP_HOST=EMBED)

    assert seen == {"cookies": {}, "user": False}


def test_without_an_embed_host_its_name_is_unknown(client, db, settings):
    settings.EMBED_HOSTNAME = ""

    assert client.get("/x/20", HTTP_HOST=EMBED).status_code == 400


def test_the_app_tells_the_frontend_where_posts_play(client, db):
    html = client.get("/inbox").content.decode()

    assert '<meta name="embed-url" content="http://embed.testserver"></head>' in html


def test_without_an_embed_host_the_app_names_none(client, db, settings):
    settings.EMBED_URL = ""

    assert "embed-url" not in client.get("/inbox").content.decode()


def test_caddy_may_get_a_certificate_for_the_embed_host(client, db):
    url = "/api/public/sites/check/"

    assert client.get(url, {"domain": EMBED}).status_code == 200
    assert client.get(url, {"domain": "other.testserver"}).status_code == 404
