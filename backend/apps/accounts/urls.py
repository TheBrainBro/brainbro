from django.urls import path

from . import oauth, views

urlpatterns = [
    path("session/", views.session, name="auth-session"),
    path("login/", views.login_view, name="auth-login"),
    path("logout/", views.logout_view, name="auth-logout"),
    path("welcome/", views.welcome_view, name="auth-welcome"),
    path("tokens/", views.tokens_view, name="auth-tokens"),
    path("tokens/<uuid:pk>/", views.token_view, name="auth-token"),
    path("oauth/register/", oauth.RegisterView.as_view(), name="oauth-register"),
    path("oauth/authorize/", oauth.AuthorizeView.as_view(), name="oauth-authorize"),
    path("oauth/token/", oauth.TokenView.as_view(), name="oauth-token"),
]
