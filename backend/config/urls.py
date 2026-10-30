from django.contrib import admin
from django.urls import include, path, re_path

from apps.core import views as core_views

api_patterns = [
    path("health/", core_views.health, name="health"),
    path("auth/", include("apps.accounts.urls")),
    path("", include("apps.items.urls")),
    path("", include("apps.boards.urls")),
    path("", include("apps.exports.urls")),
    path("", include("apps.imports.urls")),
    path("", include("apps.telegram.urls")),
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
    # Everything else is a frontend route. Excludes api/, admin/ and static/ so
    # typos there return a real 404 instead of the SPA shell.
    re_path(
        r"^(?!api/|admin/|static/|media/)(?P<path>.*)$",
        core_views.spa,
        name="spa",
    ),
]
