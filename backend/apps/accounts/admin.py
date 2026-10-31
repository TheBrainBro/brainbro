from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import ApiToken, Profile


@admin.register(Profile)
class ProfileAdmin(ModelAdmin):
    # Clearing welcome_seen_at shows the welcome tour again.
    list_display = ["__str__", "welcome_seen_at"]


@admin.register(ApiToken)
class ApiTokenAdmin(ModelAdmin):
    list_display = ["__str__", "owner", "created_at", "last_used_at"]
    readonly_fields = ["prefix", "last_used_at"]
    exclude = ["key_hash"]
