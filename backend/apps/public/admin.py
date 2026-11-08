from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Redirect, Site


@admin.register(Site)
class SiteAdmin(ModelAdmin):
    list_display = ["hostname", "owner", "collection", "status", "verified_at"]
    list_filter = ["status"]
    search_fields = ["hostname"]
    readonly_fields = ["token", "checked_at", "verified_at", "created_at", "updated_at"]


@admin.register(Redirect)
class RedirectAdmin(ModelAdmin):
    list_display = ["path", "target", "site", "owner"]
    search_fields = ["path", "target", "site__hostname"]
