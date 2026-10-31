from django.urls import path

from . import views

urlpatterns = [path("mcp/", views.McpView.as_view(), name="mcp")]
