from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import TelegramLink


@admin.register(TelegramLink)
class TelegramLinkAdmin(ModelAdmin):
    list_display = ["__str__", "owner", "linked_at"]
    readonly_fields = ["chat_id", "telegram_name", "linked_at", "last_update_id"]
    exclude = ["code"]
