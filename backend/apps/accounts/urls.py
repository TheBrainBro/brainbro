from django.urls import path

from . import oauth, views

urlpatterns = [
    path("session/", views.session, name="auth-session"),
    path("login/", views.login_view, name="auth-login"),
    path("logout/", views.logout_view, name="auth-logout"),
    path("welcome/", views.welcome_view, name="auth-welcome"),
    path("tutorial/", views.tutorial_view, name="auth-tutorial"),
    path("sample-content/", views.sample_content_view, name="auth-sample-content"),
    path("theme/", views.theme_view, name="auth-theme"),
    path("language/", views.language_view, name="auth-language"),
    path("profile/", views.profile_view, name="auth-profile"),
    path("profile/avatar/", views.avatar_view, name="auth-profile-avatar"),
    path("storage/", views.storage_view, name="auth-storage"),
    path("tokens/", views.tokens_view, name="auth-tokens"),
    path("tokens/<uuid:pk>/", views.token_view, name="auth-token"),
    path("invitations/", views.invitations_view, name="auth-invitations"),
    path("invitations/<uuid:pk>/", views.invitation_view, name="auth-invitation"),
    path("join/<str:token>/", views.join_view, name="auth-join"),
    path("oauth/register/", oauth.RegisterView.as_view(), name="oauth-register"),
    path("oauth/authorize/", oauth.AuthorizeView.as_view(), name="oauth-authorize"),
    path("oauth/token/", oauth.TokenView.as_view(), name="oauth-token"),
]
