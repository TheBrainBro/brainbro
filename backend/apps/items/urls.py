from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("items", views.ItemViewSet, basename="item")

urlpatterns = router.urls
