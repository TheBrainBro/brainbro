import re

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.items.models import Collection
from apps.public.models import Site

INDEX = "<html><head><title>BrainBro</title></head><body></body></html>"
BLOG = "blog.example.com"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


@pytest.fixture(autouse=True)
def build(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    (tmp_path / "index.html").write_text(INDEX)
    settings.FRONTEND_DIST_DIR = tmp_path


@pytest.fixture
def blog(user):
    return Site.objects.create(
        owner=user,
        hostname=BLOG,
        collection=Collection.objects.create(owner=user, name="Writing"),
        title="Alex writes",
        status=Site.Status.VERIFIED,
    )


def directives(response):
    """The enforced policy, by directive."""
    policy = response["Content-Security-Policy"]
    return {
        name: values for name, *values in (part.split() for part in policy.split(";"))
    }


def test_the_app_runs_only_its_own_scripts(client, db):
    policy = directives(client.get("/inbox"))

    assert policy["script-src"] == ["'self'", "'wasm-unsafe-eval'"]
    assert policy["object-src"] == ["'none'"]
    assert policy["frame-ancestors"] == ["'none'"]
    assert policy["frame-src"] == [
        "blob:",
        "https://www.youtube-nocookie.com",
        "https://player.vimeo.com",
        "https://www.loom.com",
    ]


def test_the_policy_is_enforced_not_only_reported(client, db):
    response = client.get("/inbox")

    assert "Content-Security-Policy" in response
    assert "Content-Security-Policy-Report-Only" not in response


def test_api_answers_carry_the_app_s_policy(api):
    policy = directives(api.get("/api/items/"))

    assert policy["script-src"] == ["'self'", "'wasm-unsafe-eval'"]


def test_a_blog_gets_its_own_stricter_policy(client, blog):
    policy = directives(client.get("/", HTTP_HOST=BLOG))

    assert policy["default-src"] == ["'none'"]
    assert policy["script-src"] == ["'self'"]
    assert policy["style-src"] == ["'self'"]
    assert policy["form-action"] == ["'none'"]
    assert "worker-src" not in policy


def test_a_blog_s_pages_have_no_inline_scripts(client, blog):
    html = client.get("/", HTTP_HOST=BLOG).content.decode()

    scripts = re.findall(r"<script\b([^>]*)>", html)
    assert scripts
    for attributes in scripts:
        assert "src=" in attributes or "application/ld+json" in attributes


def test_the_admin_may_eval_for_its_templates(admin_client):
    policy = directives(admin_client.get("/admin/"))

    assert policy["script-src"] == ["'self'", "'unsafe-eval'"]
    assert "'unsafe-inline'" not in policy["script-src"]


def test_an_uploaded_file_keeps_its_own_policy(api):
    upload = SimpleUploadedFile("logo.svg", SVG, content_type="image/svg+xml")
    item = api.post("/api/items/capture/", {"file": upload}, format="multipart")

    response = api.get(item.json()["file_url"])

    assert response["Content-Security-Policy"] == "default-src 'none'; sandbox"
    assert "Content-Security-Policy-Report-Only" not in response
