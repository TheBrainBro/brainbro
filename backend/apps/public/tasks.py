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
    another blog already verified fails too. A site moving to a new domain
    is checked on that one instead.
    """
    site = Site.objects.filter(id=site_id).first()
    if site is None:
        return
    if site.pending_hostname:
        check_move(site)
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


def check_move(site):
    """
    Moves the site to its pending domain if the TXT record proves it. Failing
    leaves it serving where it is.
    """
    hostname = site.pending_hostname
    found = site.verification_value in txt_values(site.verification_name)
    now = timezone.now()
    # Only if it is still moving there: the lookup can take a while, and its
    # owner may have changed their mind by now.
    moving = Site.objects.filter(id=site.id, pending_hostname=hostname)
    failed = {
        "pending_status": Site.Status.FAILED,
        "checked_at": now,
        "updated_at": now,
    }
    if not found:
        moving.update(**failed)
        return
    try:
        with transaction.atomic():
            moving.update(
                hostname=hostname,
                pending_hostname="",
                pending_status=Site.Status.UNVERIFIED,
                status=Site.Status.VERIFIED,
                checked_at=now,
                verified_at=now,
                updated_at=now,
            )
    except IntegrityError:
        # Another blog verified that domain first.
        moving.update(**failed)
