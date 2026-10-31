from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response

from .models import ApiToken, Invitation, Profile

# How long an invitation link can be used to join.
INVITATION_LIFETIME = timedelta(days=7)


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


class ApiTokenSerializer(serializers.ModelSerializer):
    # An app connected by signing in (OAuth), rather than a token made here.
    connected_app = serializers.SerializerMethodField()

    class Meta:
        model = ApiToken
        fields = ["id", "name", "prefix", "connected_app", "created_at", "last_used_at"]
        read_only_fields = ["prefix", "created_at", "last_used_at"]

    def get_connected_app(self, token):
        return token.client_id is not None


# Tokens are managed from the app only: a token can't list or make others.
@api_view(["GET", "POST"])
@authentication_classes([SessionAuthentication])
def tokens_view(request):
    """
    `GET` lists the user's tokens. `POST {"name"}` makes one; the response
    carries the token itself in `token`, the only time it is shown.
    """
    if request.method == "GET":
        tokens = ApiToken.objects.filter(owner=request.user)
        return Response(ApiTokenSerializer(tokens, many=True).data)
    payload = ApiTokenSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    token, key = ApiToken.issue(request.user, payload.validated_data["name"])
    return Response(
        {**ApiTokenSerializer(token).data, "token": key},
        status=status.HTTP_201_CREATED,
    )


@api_view(["DELETE"])
@authentication_classes([SessionAuthentication])
def token_view(request, pk):
    """Revokes a token: whatever uses it stops working right away."""
    ApiToken.objects.filter(owner=request.user, pk=pk).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


class InvitationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invitation
        fields = ["id", "note", "created_at", "expires_at"]
        read_only_fields = ["created_at", "expires_at"]


def join_url(request, token):
    return request.build_absolute_uri(f"/join/{token}")


# Admins only, from the app: a token can't invite anyone.
@api_view(["GET", "POST"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAdminUser])
def invitations_view(request):
    """
    `GET` lists the invitations nobody has used yet and that haven't
    expired. `POST {"note"}` makes one; the response carries its link in
    `url`, the only time it is shown.
    """
    if request.method == "GET":
        return Response(InvitationSerializer(Invitation.pending(), many=True).data)
    payload = InvitationSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    invitation, token = Invitation.issue(
        request.user, payload.validated_data.get("note", ""), INVITATION_LIFETIME
    )
    return Response(
        {**InvitationSerializer(invitation).data, "url": join_url(request, token)},
        status=status.HTTP_201_CREATED,
    )


@api_view(["DELETE"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAdminUser])
def invitation_view(request, pk):
    """Revokes an invitation: its link stops working right away."""
    Invitation.pending().filter(pk=pk).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


class JoinSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(trim_whitespace=False)

    def validate_username(self, value):
        User = get_user_model()
        for validator in User._meta.get_field("username").validators:
            try:
                validator(value)
            except ValidationError as error:
                raise serializers.ValidationError(error.messages) from None
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("This username is taken.")
        return value

    def validate(self, data):
        User = get_user_model()
        try:
            validate_password(data["password"], User(username=data["username"]))
        except ValidationError as error:
            raise serializers.ValidationError({"password": error.messages}) from None
        return data


INVALID_INVITATION = "This invitation link is invalid, used or expired."


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def join_view(request, token):
    """
    An invitation link. `GET` says whether it can still be used.
    `POST {"username", "password"}` makes the account, uses up the link and
    signs the new user in.
    """
    if request.method == "GET":
        if Invitation.find(token) is None:
            return Response({"detail": INVALID_INVITATION}, status=404)
        return Response({"valid": True})

    # Like login: no signing someone in from another site.
    SessionAuthentication().enforce_csrf(request)
    payload = JoinSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    with transaction.atomic():
        invitation = (
            Invitation.pending()
            .select_for_update()
            .filter(token_hash=ApiToken.hash(token))
            .first()
        )
        if invitation is None:
            return Response({"detail": INVALID_INVITATION}, status=404)
        user = get_user_model().objects.create_user(
            username=payload.validated_data["username"],
            password=payload.validated_data["password"],
        )
        invitation.used_at = timezone.now()
        invitation.used_by = user
        invitation.save(update_fields=["used_at", "used_by", "updated_at"])
    login(request, user)
    return Response(signed_in(user), status=status.HTTP_201_CREATED)
