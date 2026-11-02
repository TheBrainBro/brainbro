from django.urls import path

from . import views

urlpatterns = [
    path(
        "public/notes/",
        views.PublicNoteListView.as_view(),
        name="public-notes",
    ),
    path(
        "public/notes/<slug:slug>/",
        views.PublicNoteView.as_view(),
        name="public-note",
    ),
    path(
        "public/notes/<slug:slug>/images/<uuid:image_id>/",
        views.PublicNoteImageView.as_view(),
        name="public-note-image",
    ),
    path(
        "public/notes/<slug:slug>/links/<uuid:link_id>/image/",
        views.PublicNoteLinkImageView.as_view(),
        name="public-note-link-image",
    ),
]
