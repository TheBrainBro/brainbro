from django.conf import settings
from django.db import connection
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health(request):
    """Liveness + database check, used by Docker healthchecks."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        return JsonResponse({"status": "error", "database": False}, status=503)
    return JsonResponse({"status": "ok", "database": True})


@require_GET
def spa(request, path=""):
    """
    Serve the frontend's index.html for every client-side route.

    The React app handles routing and redirects to /login when the session is
    missing, so this view is public on purpose.
    """
    index = settings.FRONTEND_DIST_DIR / "index.html"
    if not index.exists():
        return HttpResponse(
            "Frontend not built. Run `make frontend-build`, or use the Vite dev "
            "server at http://localhost:5173 during development.",
            status=503,
            content_type="text/plain",
        )
    return HttpResponse(index.read_text(), content_type="text/html")
