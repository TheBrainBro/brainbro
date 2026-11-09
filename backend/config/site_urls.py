"""
The URLs of a blog on its own domain (see `apps.public.sites.SiteMiddleware`):
its pages, its feeds and the public API. Nothing else of the app
exists there: no admin, no login, no private API.
"""

from django.urls import include, path, re_path

from apps.public import feeds, site_pages
from apps.public.urls import public_patterns

handler404 = site_pages.not_found

urlpatterns = [
    path("api/", include(public_patterns)),
    path("rss", feeds.rss, name="site-rss"),
    path("sitemap.xml", feeds.sitemap, name="site-sitemap"),
    path("robots.txt", feeds.robots, name="site-robots"),
    # The index, a note at its slug, and a category at `/c/<slug>`.
    re_path(r"^(?P<path>(?:c/)?[a-z0-9-]*)/?$", site_pages.site_page, name="site-page"),
]
