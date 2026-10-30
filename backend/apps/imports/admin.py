from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Import


@admin.register(Import)
class ImportAdmin(ModelAdmin):
    list_display = ["__str__", "owner", "status", "finished_at"]
    list_filter = ["status"]
    readonly_fields = [
        "status",
        "filename",
        "counts",
        "error",
        "created_at",
        "finished_at",
    ]
