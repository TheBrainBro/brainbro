"""
The Content Security Policy of each kind of page: the app (`CSP_APP`), a
blog on its owner's domain (`CSP_SITE`) and Django's admin (`CSP_ADMIN`).
Django's middleware sends it; this one only picks which.
"""

from django.conf import settings
from django.middleware import csp

from apps.public.sites import current_site

ADMIN_PATH = "/admin/"


def policy_for(request):
    if current_site(request) is not None:
        return settings.CSP_SITE
    if request.path.startswith(ADMIN_PATH):
        return settings.CSP_ADMIN
    return settings.CSP_APP


class ContentSecurityPolicyMiddleware(csp.ContentSecurityPolicyMiddleware):
    def process_response(self, request, response):
        # A view's own policy (`csp_override`) stays as it is.
        if not hasattr(response, "_csp_config"):
            response._csp_config = policy_for(request)
        return super().process_response(request, response)
