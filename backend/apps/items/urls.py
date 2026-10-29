from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("items", views.ItemViewSet, basename="item")
router.register("collections", views.CollectionViewSet, basename="collection")

urlpatterns = router.urls
