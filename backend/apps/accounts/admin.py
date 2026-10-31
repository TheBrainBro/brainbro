from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Profile


@admin.register(Profile)
class ProfileAdmin(ModelAdmin):
    # Clearing welcome_seen_at shows the welcome tour again.
    list_display = ["__str__", "welcome_seen_at"]
