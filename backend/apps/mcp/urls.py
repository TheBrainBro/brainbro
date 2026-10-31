from django.urls import path

from . import views

urlpatterns = [
    path("mcp/", views.McpView.as_view(), name="mcp"),
    # The canonical URI apps get from the OAuth metadata has no slash.
    path("mcp", views.McpView.as_view(), name="mcp-bare"),
]
