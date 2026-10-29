from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Export


@admin.register(Export)
class ExportAdmin(ModelAdmin):
    list_display = ["__str__", "owner", "status", "size", "finished_at"]
    list_filter = ["status"]
    readonly_fields = ["status", "size", "created_at", "finished_at"]
