from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Collection, Item, NoteImage


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


@admin.register(NoteImage)
class NoteImageAdmin(ModelAdmin):
    list_display = ["src", "source", "status", "note", "created_at"]
    list_filter = ["source", "status"]
    search_fields = ["src"]
    raw_id_fields = ["note"]
    readonly_fields = ["created_at", "updated_at"]
