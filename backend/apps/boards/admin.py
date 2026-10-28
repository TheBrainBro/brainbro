from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Board


@admin.register(Board)
class BoardAdmin(ModelAdmin):
    list_display = ["title", "owner", "revision", "updated_at"]
    search_fields = ["title"]
    readonly_fields = ["revision", "created_at", "updated_at"]
    exclude = ["items"]
