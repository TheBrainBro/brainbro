"""
Forgotten passwords: a link by email to choose a new one.

Only works while the server can send email (apps.core.mail). The link is
Django's password reset token: it works once (it is tied to the current
password) and for `PASSWORD_RESET_TIMEOUT`. Nothing about it is stored.
"""

from django.contrib.auth import get_user_model, login
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.core import mail

from .limits import PASSWORD_RESET, PASSWORD_RESET_LINK
from .reset_links import user_for
from .tasks import send_password_reset
from .views import signed_in

EMAIL_OFF = "Email isn't set up on this server. Ask its admin to reset your password."
INVALID_LINK = "This link is invalid, used or expired."


class RequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


@api_view(["POST"])
@permission_classes([AllowAny])
def password_reset_view(request):
    """
    `POST {"email"}` sends a link to each account with that email. The answer
    is the same whether there is one or not, so it can't tell who has an
    account here.
    """
    SessionAuthentication().enforce_csrf(request)
    if not mail.enabled():
        return Response({"detail": EMAIL_OFF}, status=status.HTTP_404_NOT_FOUND)
    payload = RequestSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    PASSWORD_RESET.enforce(request)
    users = get_user_model().objects.filter(
        email__iexact=payload.validated_data["email"], is_active=True
    )
    base_url = request.build_absolute_uri("/").rstrip("/")
    for user in users:
        if user.has_usable_password():
            send_password_reset.delay(user.pk, base_url)
    return Response(status=status.HTTP_204_NO_CONTENT)


class NewPasswordSerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def password_reset_confirm_view(request, uid, token):
    """
    The link from the email. `GET` says whether it still works, and whose
    account it is. `POST {"password"}` sets the new password, which signs
    out every other session, and signs the user in here.
    """
    PASSWORD_RESET_LINK.enforce(request)
    user = user_for(uid, token)
    if user is None:
        return Response({"detail": INVALID_LINK}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response({"username": user.username})

    SessionAuthentication().enforce_csrf(request)
    payload = NewPasswordSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    password = payload.validated_data["password"]
    try:
        validate_password(password, user)
    except ValidationError as error:
        raise serializers.ValidationError({"password": error.messages}) from None
    user.set_password(password)
    user.save(update_fields=["password"])
    login(request, user)
    return Response(signed_in(user))
