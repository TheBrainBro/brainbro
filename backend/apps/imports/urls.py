from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("imports", views.ImportViewSet, basename="import")

urlpatterns = router.urls
