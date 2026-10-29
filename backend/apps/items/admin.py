from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Collection, Item


@admin.register(Collection)
class CollectionAdmin(ModelAdmin):
    list_display = ["name", "kind", "owner", "created_at"]
    list_filter = ["kind"]
    search_fields = ["name"]


@admin.register(Item)
class ItemAdmin(ModelAdmin):
    list_display = ["__str__", "kind", "status", "preview_status", "created_at"]
    list_filter = ["kind", "status", "preview_status"]
    search_fields = ["title", "body", "url"]
    filter_horizontal = ["collections"]
    readonly_fields = ["created_at", "updated_at"]
