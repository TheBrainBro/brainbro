from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import ApiToken, OAuthClient, Profile


@admin.register(Profile)
class ProfileAdmin(ModelAdmin):
    # Clearing welcome_seen_at shows the welcome tour again.
    list_display = ["__str__", "welcome_seen_at"]


@admin.register(ApiToken)
class ApiTokenAdmin(ModelAdmin):
    list_display = ["__str__", "owner", "client", "created_at", "last_used_at"]
    readonly_fields = ["prefix", "client", "expires_at", "last_used_at"]
    exclude = ["key_hash", "refresh_hash"]


@admin.register(OAuthClient)
class OAuthClientAdmin(ModelAdmin):
    # Apps register themselves; deleting one disconnects it everywhere.
    list_display = ["name", "created_at"]
    readonly_fields = ["redirect_uris"]
    exclude = ["secret_hash"]
