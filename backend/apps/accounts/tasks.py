from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import OAuthClient

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
