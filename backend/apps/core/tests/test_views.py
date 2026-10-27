import pytest
from django.test import override_settings


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
