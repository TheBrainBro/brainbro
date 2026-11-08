from celery import shared_task
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Site
from .sites import txt_values


@shared_task
def verify_site(site_id):
    """
    Looks up the site's TXT record. Found, the site is verified and starts
    serving; missing, it fails (and stops, if it was serving). A domain
    another blog already verified fails too.
    """
    site = Site.objects.filter(id=site_id).first()
    if site is None:
        return
    now = timezone.now()
    site.checked_at = now
    if site.verification_value in txt_values(site.verification_name):
        site.status = Site.Status.VERIFIED
        site.verified_at = site.verified_at or now
    else:
        site.status = Site.Status.FAILED
        site.verified_at = None
    try:
        with transaction.atomic():
            site.save(
                update_fields=["status", "checked_at", "verified_at", "updated_at"]
            )
    except IntegrityError:
        site.status = Site.Status.FAILED
        site.verified_at = None
        site.save(update_fields=["status", "checked_at", "verified_at", "updated_at"])
