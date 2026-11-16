"""
The URLs of the embed host (see `apps.public.sites.SiteMiddleware`): one page
per embedded post. Nothing else of the app exists there.
"""

from django.urls import re_path

from apps.public import embeds

urlpatterns = [
    re_path(r"^x/(?P<post_id>[0-9]{1,20})$", embeds.x_post, name="embed-x"),
]
