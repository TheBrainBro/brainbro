from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import ApiToken, Invitation, OAuthClient, Profile


@admin.register(Profile)
class ProfileAdmin(ModelAdmin):
    # Clearing welcome_seen_at shows the welcome tour again.
    list_display = ["__str__", "welcome_seen_at", "theme"]


@admin.register(ApiToken)
class ApiTokenAdmin(ModelAdmin):
    list_display = ["__str__", "owner", "client", "created_at", "last_used_at"]
    readonly_fields = ["prefix", "client", "expires_at", "last_used_at"]
    exclude = ["key_hash", "refresh_hash"]


@admin.register(Invitation)
class InvitationAdmin(ModelAdmin):
    # Made from the app's settings, where the link is shown once. Deleting
    # one revokes it.
    list_display = ["__str__", "created_by", "expires_at", "used_at", "used_by"]
    readonly_fields = ["created_by", "expires_at", "used_at", "used_by"]
    exclude = ["token_hash"]

    def has_add_permission(self, request):
        return False


@admin.register(OAuthClient)
class OAuthClientAdmin(ModelAdmin):
    # Apps register themselves; deleting one disconnects it everywhere.
    list_display = ["name", "created_at"]
    readonly_fields = ["redirect_uris"]
    exclude = ["secret_hash"]
