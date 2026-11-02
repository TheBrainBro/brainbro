from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import FileResponse, Http404
from django.urls import reverse
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

from apps.boards.models import Board
from apps.items.collection_images import make_square_image
from apps.items.models import Collection, Item

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


class SampleContentSerializer(serializers.Serializer):
    mcp_url = serializers.URLField(max_length=2048)


def profile_data(profile):
    """The profile as the app shows it: `{display_name, avatar_url}`."""
    avatar_url = None
    if profile and profile.avatar:
        # Authenticated, and the file name busts the cache.
        name = profile.avatar.name.rsplit("/", 1)[-1]
        avatar_url = f"{reverse('auth-profile-avatar')}?v={name}"
    return {
        "display_name": profile.display_name if profile else "",
        "avatar_url": avatar_url,
    }


def signed_in(user):
    profile = Profile.objects.filter(user=user).first()
    return {
        "authenticated": True,
        "user": UserSerializer(user).data,
        # The first visit opens on the welcome tour, once per user.
        "welcome_seen": bool(profile and profile.welcome_seen_at),
        "has_sample_content": bool(
            profile
            and profile.sample_content_created_at
            and (
                Item.objects.filter(owner=user, is_sample=True).exists()
                or Collection.objects.filter(owner=user, is_sample=True).exists()
                or Board.objects.filter(owner=user, is_sample=True).exists()
            )
        ),
        "theme": profile.theme if profile else Profile.Theme.SYSTEM,
        "language": profile.language if profile else Profile.Language.SYSTEM,
        "profile": profile_data(profile),
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


@api_view(["POST", "DELETE"])
def sample_content_view(request):
    """Create the starter once, or remove only its explicitly marked records."""
    from .sample_content import create_sample_content, remove_sample_content

    if request.method == "POST":
        payload = SampleContentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        create_sample_content(request.user, payload.validated_data["mcp_url"])
    else:
        remove_sample_content(request.user)
    return Response(status=status.HTTP_204_NO_CONTENT)


class ThemeSerializer(serializers.Serializer):
    theme = serializers.ChoiceField(choices=Profile.Theme.choices)


@api_view(["PUT"])
def theme_view(request):
    """`PUT {"theme"}`: light, dark or system, the same on every device."""
    payload = ThemeSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    profile, _ = Profile.objects.get_or_create(user=request.user)
    profile.theme = payload.validated_data["theme"]
    profile.save(update_fields=["theme", "updated_at"])
    return Response(status=status.HTTP_204_NO_CONTENT)


class LanguageSerializer(serializers.Serializer):
    language = serializers.ChoiceField(choices=Profile.Language.choices)


@api_view(["PUT"])
def language_view(request):
    """`PUT {"language"}`: the app's language, or the browser's, on every device."""
    payload = LanguageSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    profile, _ = Profile.objects.get_or_create(user=request.user)
    profile.language = payload.validated_data["language"]
    profile.save(update_fields=["language", "updated_at"])
    return Response(status=status.HTTP_204_NO_CONTENT)


class ProfileSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=80, allow_blank=True)


@api_view(["PATCH"])
def profile_view(request):
    """`PATCH {"display_name"}`: how the user signs what they publish."""
    payload = ProfileSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    profile, _ = Profile.objects.get_or_create(user=request.user)
    profile.display_name = payload.validated_data["display_name"]
    profile.save(update_fields=["display_name", "updated_at"])
    return Response(profile_data(profile))


class AvatarSerializer(serializers.Serializer):
    # Checked by make_square_image, size first.
    file = serializers.FileField(allow_empty_file=False)


@api_view(["GET", "POST", "DELETE"])
def avatar_view(request):
    """GET the profile photo, POST a new one (multipart `file`), DELETE it."""
    profile, _ = Profile.objects.get_or_create(user=request.user)
    if request.method == "GET":
        if not profile.avatar:
            raise Http404
        response = FileResponse(profile.avatar.open("rb"), content_type="image/webp")
        # The URL carries a per-file version, so the content never changes.
        response["Cache-Control"] = "private, max-age=31536000, immutable"
        return response

    old = profile.avatar.name if profile.avatar else None
    if request.method == "POST":
        upload = AvatarSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        data = make_square_image(upload.validated_data["file"])
        if data is None:
            raise serializers.ValidationError(
                {"file": "Use a JPEG, PNG, GIF or WebP image under 2 MB."}
            )
        profile.avatar.save("avatar.webp", ContentFile(data), save=False)
    else:
        profile.avatar = ""
    profile.save(update_fields=["avatar", "updated_at"])
    if old:
        profile.avatar.storage.delete(old)
    return Response(profile_data(profile))


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
    status = serializers.CharField(read_only=True)
    # Null once accepted if that account was deleted since.
    used_by = serializers.CharField(
        source="used_by.username", read_only=True, default=None
    )

    class Meta:
        model = Invitation
        fields = [
            "id",
            "note",
            "created_at",
            "expires_at",
            "status",
            "used_at",
            "used_by",
        ]
        read_only_fields = ["created_at", "expires_at", "used_at"]


def join_url(request, token):
    return request.build_absolute_uri(f"/join/{token}")


# Admins only, from the app: a token can't invite anyone.
@api_view(["GET", "POST"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAdminUser])
def invitations_view(request):
    """
    `GET` lists every invitation with its `status`: pending, accepted (by
    `used_by`, at `used_at`) or expired. `POST {"note"}` makes one; the
    response carries its link in `url`, the only time it is shown.
    """
    if request.method == "GET":
        invitations = Invitation.objects.select_related("used_by")
        return Response(InvitationSerializer(invitations, many=True).data)
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
    """
    Revokes a pending invitation, so its link stops working right away, or
    removes an expired one from the list. Accepted ones stay.
    """
    Invitation.objects.filter(pk=pk, used_at__isnull=True).delete()
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
