from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import ApiToken, Invitation, OAuthClient, Profile


class ViewAndDeleteAdmin(ModelAdmin):
    """Made by the app, never here: the admin can look and delete (revoke)."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Profile)
class ProfileAdmin(ModelAdmin):
    # The app makes and edits profiles; here only the storage quota changes.
    list_display = ["__str__", "welcome_seen_at", "theme", "language", "storage_quota"]
    editable_fields = ["storage_quota"]

    def has_add_permission(self, request):
        return False

    def get_readonly_fields(self, request, obj=None):
        return [
            field.name
            for field in Profile._meta.fields
            if field.editable and field.name not in self.editable_fields
        ]


@admin.register(ApiToken)
class ApiTokenAdmin(ViewAndDeleteAdmin):
    list_display = [
        "__str__",
        "owner",
        "client",
        "client_app",
        "redirect_host",
        "created_at",
        "last_used_at",
    ]
    exclude = ["key_hash", "refresh_hash"]


@admin.register(Invitation)
class InvitationAdmin(ViewAndDeleteAdmin):
    # Made from the app's settings, where the link is shown once. Deleting
    # one revokes it.
    list_display = ["__str__", "created_by", "expires_at", "used_at", "used_by"]
    exclude = ["token_hash"]


@admin.register(OAuthClient)
class OAuthClientAdmin(ViewAndDeleteAdmin):
    # Apps register themselves; deleting one disconnects it everywhere.
    list_display = ["name", "created_at"]
    exclude = ["secret_hash"]
