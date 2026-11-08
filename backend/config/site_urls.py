"""
The URLs of a blog on its own domain (see `apps.public.sites.SiteMiddleware`):
its pages, its feeds and the public API they read. Nothing else of the app
exists there: no admin, no login, no private API.
"""

from django.urls import include, path, re_path

from apps.core import views as core_views
from apps.public import feeds
from apps.public.urls import public_patterns

urlpatterns = [
    path("api/", include(public_patterns)),
    path("rss", feeds.rss, name="site-rss"),
    path("sitemap.xml", feeds.sitemap, name="site-sitemap"),
    path("robots.txt", feeds.robots, name="site-robots"),
    # The index, and a note at its slug.
    re_path(r"^(?P<path>[a-z0-9-]*)/?$", core_views.spa, name="site-page"),
]
