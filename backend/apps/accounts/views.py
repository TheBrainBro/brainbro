from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Profile


class UserSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    email = serializers.EmailField()
    is_staff = serializers.BooleanField()


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)


def signed_in(user):
    profile = Profile.objects.filter(user=user).first()
    return {
        "authenticated": True,
        "user": UserSerializer(user).data,
        # The first visit opens on the welcome tour, once per user.
        "welcome_seen": bool(profile and profile.welcome_seen_at),
        # Lets the frontend refuse a file before uploading it.
        "limits": {"upload_max_size": settings.UPLOAD_MAX_SIZE},
    }


@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def session(request):
    """
    Current session state. Also sets the csrftoken cookie, so the frontend
    calls this first and then sends the token in X-CSRFToken.
    """
    if not request.user.is_authenticated:
        return Response({"authenticated": False, "user": None})
    return Response(signed_in(request.user))


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    # DRF only enforces CSRF for already-authenticated sessions; enforce it
    # here too to prevent login CSRF.
    SessionAuthentication().enforce_csrf(request)
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = authenticate(request, **serializer.validated_data)
    if user is None:
        return Response(
            {"detail": "Invalid username or password."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    login(request, user)
    return Response(signed_in(user))


@api_view(["POST"])
def logout_view(request):
    logout(request)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
def welcome_view(request):
    """Marks the welcome tour as seen, so no other device shows it again."""
    profile, _ = Profile.objects.get_or_create(user=request.user)
    if profile.welcome_seen_at is None:
        profile.welcome_seen_at = timezone.now()
        profile.save(update_fields=["welcome_seen_at", "updated_at"])
    return Response(status=status.HTTP_204_NO_CONTENT)
