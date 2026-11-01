from django.contrib import admin
from django.urls import include, path, re_path

from apps.accounts import discovery
from apps.core import views as core_views

api_patterns = [
    path("health/", core_views.health, name="health"),
    path("auth/", include("apps.accounts.urls")),
    path("", include("apps.items.urls")),
    path("", include("apps.boards.urls")),
    path("", include("apps.exports.urls")),
    path("", include("apps.graph.urls")),
    path("", include("apps.imports.urls")),
    path("", include("apps.telegram.urls")),
    path("", include("apps.mcp.urls")),
    path("", include("apps.events.urls")),
    path("", include("apps.history.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(api_patterns)),
    re_path(
        r"^(?P<name>sw\.js|manifest\.webmanifest)$",
        core_views.pwa_file,
        name="pwa-file",
    ),
    path("share", core_views.share, name="share"),
    # OAuth discovery for MCP clients (apps.accounts.oauth).
    re_path(
        r"^\.well-known/oauth-protected-resource(?:/api/mcp/?)?$",
        discovery.protected_resource,
        name="oauth-protected-resource",
    ),
    path(
        ".well-known/oauth-authorization-server",
        discovery.authorization_server,
        name="oauth-authorization-server",
    ),
    # Everything else is a frontend route. Excludes api/, admin/ and static/ so
    # typos there return a real 404 instead of the SPA shell, and `/admin`
    # without its slash gets redirected to the admin (APPEND_SLASH).
    re_path(
        r"^(?!(?:api|admin|static|media)(?:/|$))(?P<path>.*)$",
        core_views.spa,
        name="spa",
    ),
]
