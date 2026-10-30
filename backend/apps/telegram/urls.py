from django.urls import path

from . import views

urlpatterns = [
    path("telegram/", views.TelegramView.as_view(), name="telegram"),
    path(
        "telegram/connect/",
        views.TelegramConnectView.as_view(),
        name="telegram-connect",
    ),
    path(
        "telegram/webhook/",
        views.TelegramWebhookView.as_view(),
        name="telegram-webhook",
    ),
]
