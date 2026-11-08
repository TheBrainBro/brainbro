from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("sites", views.SiteViewSet, basename="site")

# What anyone can read: on the app's hosts, and the only API a blog has.
public_patterns = [
    path(
        "public/notes/",
        views.PublicNoteListView.as_view(),
        name="public-notes",
    ),
    path(
        "public/notes/<slug:handle>/<slug:slug>/",
        views.PublicNoteView.as_view(),
        name="public-note",
    ),
    path(
        "public/notes/<slug:handle>/<slug:slug>/images/<uuid:image_id>/",
        views.PublicNoteImageView.as_view(),
        name="public-note-image",
    ),
    path(
        "public/notes/<slug:handle>/<slug:slug>/links/<uuid:link_id>/image/",
        views.PublicNoteLinkImageView.as_view(),
        name="public-note-link-image",
    ),
    path(
        "public/legacy/<slug:slug>/",
        views.LegacyPublicNoteView.as_view(),
        name="public-legacy-note",
    ),
    path(
        "public/authors/<slug:handle>/",
        views.PublicAuthorView.as_view(),
        name="public-author",
    ),
    path("public/site/", views.PublicSiteView.as_view(), name="public-site"),
    path(
        "public/sites/check/", views.SiteCheckView.as_view(), name="public-site-check"
    ),
]

urlpatterns = [*public_patterns, *router.urls]
