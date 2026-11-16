"""
The Content Security Policy of each kind of page: the app (`CSP_APP`), a
blog on its owner's domain (`CSP_SITE`), the embed host (`CSP_EMBED`) and
Django's admin (`CSP_ADMIN`). Django's middleware sends it; this one only
picks which.
"""

from django.conf import settings
from django.middleware import csp

from apps.public.sites import current_site, is_embed_request

ADMIN_PATH = "/admin/"


def with_embed_host(policy):
    """`policy`, also framing the embed host's pages when there is one."""
    if not settings.EMBED_URL:
        return policy
    return {**policy, "frame-src": [*policy["frame-src"], settings.EMBED_URL]}


def policy_for(request):
    if is_embed_request(request):
        return settings.CSP_EMBED
    if current_site(request) is not None:
        return with_embed_host(settings.CSP_SITE)
    if request.path.startswith(ADMIN_PATH):
        return settings.CSP_ADMIN
    return with_embed_host(settings.CSP_APP)


class ContentSecurityPolicyMiddleware(csp.ContentSecurityPolicyMiddleware):
    def process_response(self, request, response):
        # A view's own policy (`csp_override`) stays as it is.
        if not hasattr(response, "_csp_config"):
            response._csp_config = policy_for(request)
        return super().process_response(request, response)
