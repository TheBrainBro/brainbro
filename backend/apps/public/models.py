import secrets
import uuid

from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver

from apps.core.models import OwnedModel
from apps.items.models import Collection


def new_token():
    return secrets.token_hex(16)


def site_avatar_path(site, filename):
    # A fresh name per upload, so a new photo never hits a stale cache.
    return f"avatars/sites/{site.id}/{uuid.uuid4().hex}.webp"


def site_social_image_path(site, filename):
    # A fresh name per upload, so a new image never hits a stale cache.
    return f"social/sites/{site.id}/{uuid.uuid4().hex}.jpg"


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
    # Who signs it and its photo, for a blog that isn't its owner speaking as
    # themselves. Empty: its owner's display name and photo.
    author = models.CharField(max_length=80, blank=True, default="", db_default="")
    # A square WebP, made from an upload like the profile's.
    avatar = models.ImageField(upload_to=site_avatar_path, blank=True, db_default="")
    # Where search engines learn who the author is. Empty: nothing says.
    author_url = models.URLField(max_length=500, blank=True, default="", db_default="")
    # A 1200 x 630 JPEG, for links to pages with no image of their own.
    social_image = models.ImageField(
        upload_to=site_social_image_path, blank=True, db_default=""
    )
    # The author's line under the name on its index. Off, its feed and shared
    # links still say who signs it.
    show_author = models.BooleanField(default=True, db_default=True)
    # Shown on its index under the description: `[{"name", "url"}]`, up to 10.
    links = models.JSONField(default=list, blank=True)
    # A small "Powered by BrainBro" line at the end of its pages.
    powered_by = models.BooleanField(default=True)
    token = models.CharField(max_length=64, default=new_token, editable=False)
    status = models.CharField(max_length=16, choices=Status, default=Status.UNVERIFIED)
    checked_at = models.DateTimeField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    # The domain a serving blog is moving to. It keeps serving at `hostname`
    # until this one is verified, and `status` says nothing about this one.
    pending_hostname = models.CharField(max_length=253, blank=True, default="")
    pending_status = models.CharField(
        max_length=16, choices=Status, default=Status.UNVERIFIED
    )

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
    def domain_to_verify(self):
        """The domain it is moving to, or else its own."""
        return self.pending_hostname or self.hostname

    @property
    def verification_name(self):
        """Where its TXT record goes."""
        return f"_brainbro.{self.domain_to_verify}"

    @property
    def verification_value(self):
        return f"brainbro-site-verification={self.token}"

    @property
    def is_verified(self):
        return self.status == self.Status.VERIFIED

    def start_check(self):
        """Says its domain is being checked. A blog moving keeps serving."""
        field = "pending_status" if self.pending_hostname else "status"
        setattr(self, field, self.Status.CHECKING)
        self.save(update_fields=[field, "updated_at"])

    @property
    def name(self):
        return self.title or (self.collection.name if self.collection else "")


@receiver(post_delete, sender=Site)
def delete_site_images(sender, instance, **kwargs):
    if instance.avatar:
        instance.avatar.delete(save=False)
    if instance.social_image:
        instance.social_image.delete(save=False)


class Redirect(OwnedModel):
    """
    An old address on a blog that sends readers to a new one, for good (301):
    a post that moved there from somewhere else keeps its links working, and
    search engines move it over. `path` is as `apps.public.redirects` writes
    it; `target` a path on the same blog or a whole http(s) URL.
    """

    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name="redirects")
    path = models.CharField(max_length=2048)
    target = models.CharField(max_length=2048)

    class Meta:
        ordering = ["path"]
        constraints = [
            models.UniqueConstraint(
                fields=["site", "path"], name="unique_redirect_path_per_site"
            ),
        ]

    def __str__(self):
        return f"{self.path} -> {self.target}"
