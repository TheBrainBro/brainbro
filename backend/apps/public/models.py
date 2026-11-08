import secrets

from django.db import models

from apps.core.models import OwnedModel
from apps.items.models import Collection


def new_token():
    return secrets.token_hex(16)


class Site(OwnedModel):
    """
    A blog on its owner's own domain: the published notes filed in
    `collection`, served at `https://<hostname>/<slug>` (see `apps.public.sites`).

    It serves nothing until the domain is verified: its owner adds a TXT
    record with `token` (`verification_record`), which only someone who
    controls the domain's DNS can do, so nobody can claim someone else's.
    """

    class Status(models.TextChoices):
        UNVERIFIED = "unverified", "Unverified"
        CHECKING = "checking", "Checking"
        FAILED = "failed", "Failed"
        VERIFIED = "verified", "Verified"

    # Lowercase, without a port or a trailing dot. Unique once verified only:
    # someone who adds a domain that isn't theirs can't keep its owner out.
    hostname = models.CharField(max_length=253)
    # Deleting the collection leaves the blog empty, not gone.
    collection = models.ForeignKey(
        Collection,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sites",
    )
    # The blog's name and blurb on its index, feed and shared links. Empty:
    # the collection's name, no description.
    title = models.CharField(max_length=120, blank=True, default="")
    description = models.CharField(max_length=300, blank=True, default="")
    token = models.CharField(max_length=64, default=new_token, editable=False)
    status = models.CharField(max_length=16, choices=Status, default=Status.UNVERIFIED)
    checked_at = models.DateTimeField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "hostname"], name="unique_site_hostname_per_owner"
            ),
            models.UniqueConstraint(
                fields=["hostname"],
                condition=models.Q(status="verified"),
                name="unique_verified_site_hostname",
            ),
        ]

    def __str__(self):
        return self.hostname

    @property
    def verification_name(self):
        """Where its TXT record goes."""
        return f"_brainbro.{self.hostname}"

    @property
    def verification_value(self):
        return f"brainbro-site-verification={self.token}"

    @property
    def is_verified(self):
        return self.status == self.Status.VERIFIED

    @property
    def name(self):
        return self.title or (self.collection.name if self.collection else "")
