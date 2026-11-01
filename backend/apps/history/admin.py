from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Revision


@admin.register(Revision)
class RevisionAdmin(ModelAdmin):
    list_display = ["title", "owner", "by", "via", "created_at", "updated_at"]
    search_fields = ["title"]
    readonly_fields = ["item", "board", "restored_from", "created_at", "updated_at"]
