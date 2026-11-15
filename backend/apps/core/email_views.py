"""
Settings, Server, Email: how the server sends email, for admins only.

Saving stores the settings in the database, where they are used instead of
the environment's; `DELETE` goes back to the environment's. The API key is
never sent back: only whether there is one.
"""

from django.conf import settings
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from . import mail, secrets
from .models import EmailSettings

TEST_BODY = """This is a test email from {app}.

If you can read it, {app} can send password reset links and invitations.
"""


def email_settings_data():
    current = mail.config()
    environment = mail.environment_config()
    return {
        "source": current.source,
        "enabled": mail.provider(current) is not None,
        "provider": current.provider,
        "from_email": current.from_email,
        "default_from": mail.default_from(current),
        "mailgun_domain": current.mailgun_domain,
        "mailgun_region": current.mailgun_region,
        "has_api_key": bool(current.mailgun_api_key),
        # Whether there is anything to go back to.
        "environment_enabled": mail.provider(environment) is not None,
    }


class EmailSettingsSerializer(serializers.Serializer):
    provider = serializers.ChoiceField(
        choices=EmailSettings.Provider.choices, allow_blank=True
    )
    from_email = serializers.CharField(max_length=254, allow_blank=True, default="")
    mailgun_domain = serializers.CharField(max_length=253, allow_blank=True, default="")
    mailgun_region = serializers.ChoiceField(
        choices=EmailSettings.Region.choices, default=EmailSettings.Region.US
    )
    # Blank keeps the key in use.
    mailgun_api_key = serializers.CharField(
        allow_blank=True, default="", trim_whitespace=True, write_only=True
    )

    def validate_mailgun_domain(self, value):
        return value.strip().lower()

    def validate(self, data):
        if data["provider"] != EmailSettings.Provider.MAILGUN:
            return data
        errors = {}
        if not data["mailgun_domain"]:
            errors["mailgun_domain"] = ["Enter the domain Mailgun sends from."]
        if not data["mailgun_api_key"] and not self.context["current_key"]:
            errors["mailgun_api_key"] = ["Enter a Mailgun sending API key."]
        if errors:
            raise serializers.ValidationError(errors)
        return data


@api_view(["GET", "PUT", "DELETE"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAdminUser])
def email_settings_view(request):
    """
    `GET` says how email is set up. `PUT {"provider", "from_email",
    "mailgun_domain", "mailgun_region", "mailgun_api_key"?}` saves it here,
    over the environment. `DELETE` goes back to the environment's.
    """
    if request.method == "DELETE":
        EmailSettings.objects.all().delete()
        return Response(email_settings_data())

    if request.method == "PUT":
        current_key = mail.config().mailgun_api_key
        payload = EmailSettingsSerializer(
            data=request.data, context={"current_key": current_key}
        )
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        key = data["mailgun_api_key"] or current_key
        EmailSettings.objects.update_or_create(
            singleton=True,
            defaults={
                "provider": data["provider"],
                "from_email": data["from_email"].strip(),
                "mailgun_domain": data["mailgun_domain"],
                "mailgun_region": data["mailgun_region"],
                "mailgun_api_key": secrets.encrypt(key),
            },
        )
    return Response(email_settings_data())


@api_view(["POST"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAdminUser])
def email_test_view(request):
    """Sends a test email to the admin asking, right now, to see that it works."""
    if not mail.enabled():
        return Response(
            {"detail": "Email is off: set up a provider first."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not request.user.email:
        return Response(
            {"detail": "Add your email in Settings, Profile: the test goes there."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        mail.send(
            f"Test email from {settings.APP_NAME}",
            TEST_BODY.format(app=settings.APP_NAME),
            [request.user.email],
        )
    except Exception as error:  # Any provider error: the admin sees it.
        return Response(
            {"detail": f"The email couldn't be sent: {error}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return Response({"sent_to": request.user.email})
