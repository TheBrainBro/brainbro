import uuid

from django.conf import settings
from django.db import models


class TimestampedModel(models.Model):
    """UUID primary key plus creation/update timestamps."""

    # UUIDs keep ids stable across exports, imports and future sync.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class OwnedModel(TimestampedModel):
    """
    Base for every user content model.

    There is a single user for now, but every row belongs to someone from day
    one so the app can become multi-user without a painful data migration.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="+",
    )

    class Meta:
        abstract = True
