from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("items", views.ItemViewSet, basename="item")
router.register("note-images", views.NoteImageViewSet, basename="note-image")
router.register("note-links", views.NoteLinkViewSet, basename="note-link")
router.register("collections", views.CollectionViewSet, basename="collection")

urlpatterns = router.urls
