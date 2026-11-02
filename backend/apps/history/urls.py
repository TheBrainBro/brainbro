from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("revisions", views.RevisionViewSet, basename="revision")

urlpatterns = router.urls
