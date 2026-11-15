from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.utils import timezone

from apps.core import mail

from .models import OAuthClient
from .reset_links import reset_path

# Long enough for any sign-in in progress to finish.
UNUSED_CLIENT_AGE = timedelta(days=1)


@shared_task
def delete_unused_oauth_clients():
    """
    Apps register before the user allows them, and the registration stays
    when the sign-in is abandoned or the app is disconnected. Without a token
    or a code on its way, a client is of no use to anyone.
    """
    now = timezone.now()
    OAuthClient.objects.filter(
        created_at__lt=now - UNUSED_CLIENT_AGE, apitoken__isnull=True
    ).exclude(authorizationcode__expires_at__gt=now).delete()


RESET_EMAIL = """Hi {username},

Someone asked to reset the password of your {app} account, {username}.
To choose a new one, open this link:

{url}

It works once, for the next hour. If it wasn't you, ignore this email:
your password stays as it is.
"""


@shared_task
def send_password_reset(user_id, base_url):
    """
    Emails a password reset link. The worker makes the link, so it never
    sits in the queue.
    """
    user = get_user_model().objects.filter(pk=user_id, is_active=True).first()
    if user is None or not user.email:
        return
    send_mail(
        subject=f"Reset your {settings.APP_NAME} password",
        message=RESET_EMAIL.format(
            username=user.username,
            app=settings.APP_NAME,
            url=base_url + reset_path(user),
        ),
        from_email=mail.from_email(),
        recipient_list=[user.email],
    )
