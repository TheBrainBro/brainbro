from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Site


@admin.register(Site)
class SiteAdmin(ModelAdmin):
    list_display = ["hostname", "owner", "collection", "status", "verified_at"]
    list_filter = ["status"]
    search_fields = ["hostname"]
    readonly_fields = ["token", "checked_at", "verified_at", "created_at", "updated_at"]
