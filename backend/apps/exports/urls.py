from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("exports", views.ExportViewSet, basename="export")

urlpatterns = router.urls
