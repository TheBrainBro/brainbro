import re

from django.conf import settings
from django.db import connection
from django.http import (
    Http404,
    HttpResponse,
    HttpResponsePermanentRedirect,
    HttpResponseRedirect,
    JsonResponse,
)
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from apps.accounts.models import Profile
from apps.items.models import Item
from apps.public.pages import (
    author_head_tags,
    note_head_tags,
    published_note_for_page,
    with_head_tags,
)
from apps.public.sites import public_url

# A published note on the server, and where notes were before handles.
NOTE_PAGE = re.compile(r"@(?P<handle>[a-z0-9-]+)/(?P<slug>[a-z0-9-]+)/?")
AUTHOR_PAGE = re.compile(r"@(?P<handle>[a-z0-9-]+)/?")
LEGACY_PAGE = re.compile(r"p/(?P<slug>[a-z0-9-]+)/?")

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


def note_page_head(request, handle, slug):
    """A note's tags at `/@<handle>/<slug>`, or a redirect to its blog."""
    note = published_note_for_page(owner__profile__handle=handle, public_slug=slug)
    if note is None:
        return None, None
    url = public_url(note)
    if not url.startswith("/"):
        return None, url
    return note_head_tags(request, note, request.build_absolute_uri(url)), None


def legacy_redirect(slug):
    """Where `/p/<slug>` lives now, while one published note has that slug."""
    notes = list(
        Item.objects.filter(
            kind=Item.Kind.NOTE, published_at__isnull=False, public_slug=slug
        ).only("id", "owner_id", "public_slug")[:2]
    )
    return public_url(notes[0]) if len(notes) == 1 else None


def page_head(request, path):
    """
    The tags of a public page at `path`, or a redirect to where it lives
    now: `/@<handle>/<slug>` on its blog, `/p/<slug>` at its new address.
    `/@<handle>` is its author's page, with all their public notes.
    `(tags, redirect)`, both None for the app's own routes.
    """
    if match := NOTE_PAGE.fullmatch(path):
        return note_page_head(request, match["handle"], match["slug"])
    if match := AUTHOR_PAGE.fullmatch(path):
        profile = Profile.objects.filter(handle=match["handle"]).first()
        return (author_head_tags(request, profile) if profile else None), None
    if match := LEGACY_PAGE.fullmatch(path):
        return None, legacy_redirect(match["slug"])
    return None, None


@require_GET
def spa(request, path=""):
    """
    Serve the frontend's index.html for every client-side route.

    The React app handles routing and redirects to /login when the session is
    missing, so this view is public on purpose. A blog's domain never gets
    here: it has its own pages (`apps.public.site_pages`).
    """
    tags, redirect = page_head(request, path)
    if redirect:
        return HttpResponsePermanentRedirect(redirect)
    index = settings.FRONTEND_DIST_DIR / "index.html"
    if not index.exists():
        return HttpResponse(
            "Frontend not built. Run `make frontend-build`, or use the Vite dev "
            "server at http://localhost:5173 during development.",
            status=503,
            content_type="text/plain",
        )
    html = index.read_text()
    # A public page says what it is to sites that read its link.
    if tags:
        html = with_head_tags(html, tags)
    # nosemgrep: direct-use-of-httpresponse -- built index.html, escaped head tags
    return HttpResponse(html, content_type="text/html")


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


# nosemgrep: no-csrf-exempt -- the POST changes nothing, it only redirects
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
