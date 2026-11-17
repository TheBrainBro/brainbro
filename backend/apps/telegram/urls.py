from django.urls import path

from . import server_views, views

urlpatterns = [
    path("telegram/", views.TelegramView.as_view(), name="telegram"),
    path(
        "telegram/connect/",
        views.TelegramConnectView.as_view(),
        name="telegram-connect",
    ),
    path(
        "server/telegram/",
        server_views.telegram_settings_view,
        name="server-telegram",
    ),
    path(
        "telegram/webhook/",
        views.TelegramWebhookView.as_view(),
        name="telegram-webhook",
    ),
]
