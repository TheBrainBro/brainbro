from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("boards", views.BoardViewSet, basename="board")

urlpatterns = router.urls
