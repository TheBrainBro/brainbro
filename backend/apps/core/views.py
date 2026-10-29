from django.conf import settings
from django.db import connection
from django.http import Http404, HttpResponse, HttpResponseRedirect, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

# Build files that must live at the root: the service worker's scope can't be
# wider than its own path, and the build's assets are under /static/.
PWA_FILES = {
    "sw.js": "text/javascript",
    "manifest.webmanifest": "application/manifest+json",
}


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


@require_GET
def pwa_file(request, name):
    """
    The service worker and the web manifest, from the frontend build.

    `no-cache` so browsers (and Cloudflare) revalidate them on every load and
    a deploy reaches installed apps right away.
    """
    path = settings.FRONTEND_DIST_DIR / name
    if name not in PWA_FILES or not path.exists():
        raise Http404
    response = HttpResponse(path.read_bytes(), content_type=PWA_FILES[name])
    response["Cache-Control"] = "no-cache"
    return response


@csrf_exempt
@require_http_methods(["GET", "POST"])
def share(request):
    """
    The Web Share Target (`POST /share`). The service worker answers it and
    hands the shared content to the app's capture pipeline; it only reaches
    Django when no service worker is active. Nothing is created here (there
    is one way to create items), so the share is lost: the app says so.

    CSRF-exempt because the POST changes nothing; GET is the app's /share
    route.
    """
    if request.method == "POST":
        response = HttpResponseRedirect("/share?lost=1")
        response.status_code = 303  # See Other: the browser follows with a GET
        return response
    return spa(request)
