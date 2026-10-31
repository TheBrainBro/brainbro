import pytest
from django.test import Client, override_settings

from apps.items.models import Item


@pytest.mark.django_db
def test_health_ok(client):
    response = client.get("/api/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": True}


def test_spa_without_build_returns_503(client, tmp_path):
    with override_settings(FRONTEND_DIST_DIR=tmp_path):
        response = client.get("/inbox")
    assert response.status_code == 503


def test_spa_serves_index_for_client_routes(client, tmp_path):
    (tmp_path / "index.html").write_text("<div id=root></div>")
    with override_settings(FRONTEND_DIST_DIR=tmp_path):
        for url in ["/", "/inbox", "/boards/abc"]:
            response = client.get(url)
            assert response.status_code == 200
            assert b"<div id=root></div>" in response.content


def test_unknown_api_route_is_404_not_spa(client, tmp_path):
    (tmp_path / "index.html").write_text("<div id=root></div>")
    with override_settings(FRONTEND_DIST_DIR=tmp_path):
        response = client.get("/api/does-not-exist/")
    assert response.status_code == 404


def test_admin_without_slash_redirects_to_the_admin(client, tmp_path):
    (tmp_path / "index.html").write_text("<div id=root></div>")
    with override_settings(FRONTEND_DIST_DIR=tmp_path):
        response = client.get("/admin")
    assert response.status_code == 301
    assert response["Location"] == "/admin/"


def test_pwa_files_are_served_from_the_root_uncached(client, tmp_path):
    (tmp_path / "sw.js").write_text("self.skipWaiting()")
    (tmp_path / "manifest.webmanifest").write_text('{"name": "Brain"}')
    with override_settings(FRONTEND_DIST_DIR=tmp_path):
        worker = client.get("/sw.js")
        manifest = client.get("/manifest.webmanifest")
    assert worker.status_code == 200
    assert worker["Content-Type"] == "text/javascript"
    assert worker["Cache-Control"] == "no-cache"
    assert worker.content == b"self.skipWaiting()"
    assert manifest["Content-Type"] == "application/manifest+json"
    assert manifest["Cache-Control"] == "no-cache"


def test_pwa_files_404_without_a_build(client, tmp_path):
    with override_settings(FRONTEND_DIST_DIR=tmp_path):
        assert client.get("/sw.js").status_code == 404
        assert client.get("/manifest.webmanifest").status_code == 404


@pytest.mark.django_db
def test_share_post_without_service_worker_redirects_and_creates_nothing():
    # No CSRF token, the way the OS share sheet sends it.
    client = Client(enforce_csrf_checks=True)
    response = client.post("/share", {"text": "hello", "url": "https://a.example"})
    assert response.status_code == 303
    assert response["Location"] == "/share?lost=1"
    assert not Item.objects.exists()


def test_share_get_is_the_spa(client, tmp_path):
    (tmp_path / "index.html").write_text("<div id=root></div>")
    with override_settings(FRONTEND_DIST_DIR=tmp_path):
        response = client.get("/share?text=hi")
    assert response.status_code == 200
    assert b"<div id=root></div>" in response.content
