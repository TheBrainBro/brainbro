from datetime import timedelta

from django.conf import settings
from django.contrib import admin
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import IntegrityError, connection, transaction
from django.http import FileResponse, Http404, HttpResponse
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
from apps.core import mail
from apps.items.collection_images import make_square_image
from apps.items.models import Collection, Item
from apps.public.handles import MAX_HANDLE, handle_taken, is_valid_handle

from .limits import INVITATION, LOGIN, TOO_MANY, WINDOW
from .models import ApiToken, Invitation, Profile
from .oauth import PermissionsSerializer
from .quota import QuotaExceeded, check_room, file_size, storage_data

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
    """The profile as the app shows it: `{display_name, handle, avatar_url}`."""
    avatar_url = None
    if profile and profile.avatar:
        # Authenticated, and the file name busts the cache.
        name = profile.avatar.name.rsplit("/", 1)[-1]
        avatar_url = f"{reverse('auth-profile-avatar')}?v={name}"
    return {
        "display_name": profile.display_name if profile else "",
        "handle": (profile.handle or "") if profile else "",
        "avatar_url": avatar_url,
    }


def tutorial_data(profile):
    """Where the guided tour stands: `{started, done, closed}`."""
    return {
        "started": bool(profile and profile.tutorial_started_at),
        "done": list(profile.tutorial_done) if profile else [],
        "closed": bool(profile and profile.tutorial_closed_at),
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
        "tutorial": tutorial_data(profile),
        "theme": profile.theme if profile else Profile.Theme.SYSTEM,
        "language": profile.language if profile else Profile.Language.SYSTEM,
        "profile": profile_data(profile),
        # Lets the frontend refuse a file before uploading it.
        "limits": {"upload_max_size": settings.UPLOAD_MAX_SIZE},
        # The About dialog links it (AGPL section 13).
        "source_code_url": settings.SOURCE_CODE_URL,
        "email_enabled": mail.enabled(),
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
        # The sign-in page offers a reset link only when it can be emailed.
        return Response(
            {"authenticated": False, "user": None, "email_enabled": mail.enabled()}
        )
    return Response(signed_in(request.user))


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    # DRF only enforces CSRF for already-authenticated sessions; enforce it
    # here too to prevent login CSRF.
    SessionAuthentication().enforce_csrf(request)
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    LOGIN.enforce(request)
    user = authenticate(request, **serializer.validated_data)
    if user is None:
        return Response(
            {"detail": "Invalid username or password."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    LOGIN.refund(request)
    login(request, user)
    return Response(signed_in(user))


def admin_login(request):
    """Django admin's sign-in: the same passwords, so the same limit."""
    if request.method != "POST":
        return admin.site.login(request)
    if LOGIN.exceeded(request):
        return HttpResponse(
            TOO_MANY,
            status=429,
            content_type="text/plain",
            headers={"Retry-After": str(WINDOW)},
        )
    response = admin.site.login(request)
    # A failed sign-in renders the form again, a good one redirects.
    if response.status_code == 302:
        LOGIN.refund(request)
    return response


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


# The first loop, then each track from the tour's hub.
TUTORIAL_PARTS = ["loop", "boards", "graph", "assistant", "examples"]


class TutorialSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["start", "done", "close"])
    part = serializers.ChoiceField(choices=TUTORIAL_PARTS, required=False)

    def validate(self, data):
        if data["action"] == "done" and "part" not in data:
            raise serializers.ValidationError({"part": "Say which part is done."})
        return data


@api_view(["POST"])
def tutorial_view(request):
    """
    `POST {"action", "part"}`: the guided tour's progress, on every device.
    `start` begins it afresh (and brings it back if it was put away), `done`
    ticks a part, `close` puts it away for good.
    """
    payload = TutorialSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    action = payload.validated_data["action"]
    profile, _ = Profile.objects.get_or_create(user=request.user)
    if action == "start":
        profile.tutorial_started_at = timezone.now()
        profile.tutorial_done = []
        profile.tutorial_closed_at = None
    elif action == "done":
        part = payload.validated_data["part"]
        if part not in profile.tutorial_done:
            profile.tutorial_done = [*profile.tutorial_done, part]
    elif profile.tutorial_closed_at is None:
        profile.tutorial_closed_at = timezone.now()
    profile.save(
        update_fields=[
            "tutorial_started_at",
            "tutorial_done",
            "tutorial_closed_at",
            "updated_at",
        ]
    )
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
    display_name = serializers.CharField(
        max_length=80, allow_blank=True, required=False
    )
    handle = serializers.CharField(max_length=MAX_HANDLE, required=False)

    def validate_handle(self, value):
        if not is_valid_handle(value):
            raise serializers.ValidationError(
                "Use lowercase letters, numbers and hyphens, 2 or more."
            )
        if handle_taken(value, self.context["request"].user.id):
            raise serializers.ValidationError("Someone else already has this name.")
        return value


@api_view(["PATCH"])
def profile_view(request):
    """
    `PATCH {"display_name", "handle"}`, either: how the user signs what they
    publish, and the address their notes are published at (`/@<handle>/`).
    """
    payload = ProfileSerializer(data=request.data, context={"request": request})
    payload.is_valid(raise_exception=True)
    profile, _ = Profile.objects.get_or_create(user=request.user)
    fields = list(payload.validated_data)
    for name, value in payload.validated_data.items():
        setattr(profile, name, value)
    try:
        # Someone else may take the handle in between.
        with transaction.atomic():
            profile.save(update_fields=[*fields, "updated_at"])
    except IntegrityError:
        raise serializers.ValidationError(
            {"handle": "Someone else already has this name."}
        ) from None
    return Response(profile_data(profile))


EMAIL_TAKEN = "Another account already uses this email."


def email_taken(email, user_id=None):
    """Whether another account has this email, whatever its case."""
    others = get_user_model().objects.filter(email__iexact=email)
    if user_id is not None:
        others = others.exclude(pk=user_id)
    return others.exists()


class EmailSerializer(serializers.Serializer):
    # Blank removes it.
    email = serializers.EmailField(allow_blank=True)

    def validate_email(self, value):
        value = BaseUserManager.normalize_email(value)
        if value and email_taken(value, self.context["request"].user.id):
            raise serializers.ValidationError(EMAIL_TAKEN)
        return value


@api_view(["PUT"])
def email_view(request):
    """
    `PUT {"email"}`: where a password reset link goes. Optional; blank
    removes it.
    """
    payload = EmailSerializer(data=request.data, context={"request": request})
    payload.is_valid(raise_exception=True)
    request.user.email = payload.validated_data["email"]
    request.user.save(update_fields=["email"])
    return Response({"email": request.user.email})


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
        try:
            check_room(request.user, len(data), freed=file_size(profile.avatar))
        except QuotaExceeded as exc:
            raise serializers.ValidationError({"file": str(exc)}) from None
        profile.avatar.save("avatar.webp", ContentFile(data), save=False)
    else:
        profile.avatar = ""
    profile.save(update_fields=["avatar", "updated_at"])
    if old:
        profile.avatar.storage.delete(old)
    return Response(profile_data(profile))


@api_view(["GET"])
def storage_view(request):
    """How much the user stores on disk, and their quota (null: no limit)."""
    return Response(storage_data(request.user))


class ApiTokenSerializer(serializers.ModelSerializer):
    # An app connected by signing in (OAuth), rather than a token made here.
    connected_app = serializers.SerializerMethodField()

    class Meta:
        model = ApiToken
        fields = [
            "id",
            "name",
            "prefix",
            "connected_app",
            "permissions",
            "created_at",
            "last_used_at",
        ]
        read_only_fields = ["prefix", "permissions", "created_at", "last_used_at"]

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


@api_view(["PATCH", "DELETE"])
@authentication_classes([SessionAuthentication])
def token_view(request, pk):
    """
    `DELETE` revokes a token: whatever uses it stops working right away.
    `PATCH {"permissions"}` changes what a connected app may do.
    """
    tokens = ApiToken.objects.filter(owner=request.user, pk=pk)
    if request.method == "DELETE":
        tokens.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    token = tokens.filter(client__isnull=False).first()
    if token is None:
        raise Http404
    payload = PermissionsSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    token.permissions = payload.validated_data["permissions"]
    token.save(update_fields=["permissions", "updated_at"])
    return Response(ApiTokenSerializer(token).data)


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
    # Optional: only for resetting a forgotten password.
    email = serializers.EmailField(allow_blank=True, required=False, default="")

    def validate_email(self, value):
        value = BaseUserManager.normalize_email(value)
        if value and email_taken(value):
            raise serializers.ValidationError(EMAIL_TAKEN)
        return value

    def validate_username(self, value):
        User = get_user_model()
        for validator in User._meta.get_field("username").validators:
            try:
                validator(value)
            except ValidationError as error:
                raise serializers.ValidationError(error.messages) from None
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError(USERNAME_TAKEN)
        return value

    def validate(self, data):
        User = get_user_model()
        try:
            validate_password(data["password"], User(username=data["username"]))
        except ValidationError as error:
            raise serializers.ValidationError({"password": error.messages}) from None
        return data


INVALID_INVITATION = "This invitation link is invalid, used or expired."
USERNAME_TAKEN = "This username is taken."


def claim_username(username):
    """
    Holds `username`, whatever its case, until the transaction ends, so two
    people joining at once can't both get it as "Alex" and "alex": the
    database only tells them apart by case. True if it was free.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))", [f"join:{username.lower()}"]
        )
    return not get_user_model().objects.filter(username__iexact=username).exists()


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def join_view(request, token):
    """
    An invitation link. `GET` says whether it can still be used.
    `POST {"username", "password", "email"?}` makes the account, uses up the link and
    signs the new user in.
    """
    INVITATION.enforce(request)
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
        username = payload.validated_data["username"]
        if not claim_username(username):
            return Response({"username": [USERNAME_TAKEN]}, status=400)
        user = get_user_model().objects.create_user(
            username=username,
            email=payload.validated_data["email"],
            password=payload.validated_data["password"],
        )
        invitation.used_at = timezone.now()
        invitation.used_by = user
        invitation.save(update_fields=["used_at", "used_by", "updated_at"])
    login(request, user)
    return Response(signed_in(user), status=status.HTTP_201_CREATED)
