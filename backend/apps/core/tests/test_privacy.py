"""
Whoever runs the server can't read people's content through the app: the
admin holds only what running the server needs, and the logs carry ids,
not what people saved or searched for.
"""

import logging

import pytest
from django.contrib import admin

from apps.core.logs import DropQueryString
from apps.items.models import Item

SECRET = "their-secret"


def test_the_admin_holds_no_ones_content():
    registered = {model._meta.label for model in admin.site._registry}

    assert registered == {
        "auth.Group",
        "auth.User",
        "accounts.Profile",
        "accounts.ApiToken",
        "accounts.Invitation",
        "accounts.OAuthClient",
    }


@pytest.mark.parametrize(
    "path", ["/admin/", "/admin/auth/user/", "/admin/accounts/apitoken/"]
)
def test_a_superuser_doesnt_see_notes_in_the_admin(admin_client, other_user, path):
    Item.objects.create(
        owner=other_user, kind=Item.Kind.NOTE, title=SECRET, body=SECRET
    )

    response = admin_client.get(path)

    assert response.status_code == 200
    assert SECRET not in response.content.decode()


def test_the_admin_has_no_page_for_notes(admin_client):
    assert admin_client.get("/admin/items/item/").status_code == 404


def access_record(path):
    return logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        0,
        '%s - "%s %s HTTP/%s" %d',
        ("10.0.0.1:5000", "GET", path, "1.1", 200),
        None,
    )


def test_the_access_log_drops_the_query_string():
    record = access_record(f"/api/items/?q={SECRET}&kind=note")

    assert DropQueryString().filter(record)
    assert record.getMessage() == '10.0.0.1:5000 - "GET /api/items/ HTTP/1.1" 200'


def test_the_access_log_keeps_paths_without_a_query():
    record = access_record("/api/items/")

    assert DropQueryString().filter(record)
    assert record.getMessage() == '10.0.0.1:5000 - "GET /api/items/ HTTP/1.1" 200'


def test_uvicorn_access_goes_through_the_filter():
    logger = logging.getLogger("uvicorn.access")

    filters = [f for handler in logger.handlers for f in handler.filters]

    assert any(isinstance(f, DropQueryString) for f in filters)
    assert not logger.propagate
