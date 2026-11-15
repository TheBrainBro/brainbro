"""
Posts from X, embedded in notes. X's embed runs X's own script, so it never
runs in the app's or a blog's pages: notes frame this page, served from the
embed host (`EMBED_HOSTNAME`), an origin of its own with no cookies and its
own policy (`CSP_EMBED`). The page tells the note its height
(`public/embed-height.js`), and the note sizes the frame to it.
"""

from django.shortcuts import render
from django.views.decorators.clickjacking import xframe_options_exempt
from django.views.decorators.http import require_GET


@require_GET
@xframe_options_exempt
def x_post(request, post_id):
    response = render(request, "public/embed_x.html", {"post_id": post_id})
    # Every post's page is the same but for its id: browsers and proxies can
    # keep it a day.
    response["Cache-Control"] = "public, max-age=86400"
    return response
