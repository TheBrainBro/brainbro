"""
What anyone can read, signed in or not: published notes and their images.
Nothing else of a note's owner is reachable from here, and a note taken down
answers 404 at once, as if it never existed.

On a blog's domain (`current_site(request)`) only that blog's notes exist.
"""

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from django.urls import reverse
from rest_framework import generics, mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.items.models import Collection, Item, NoteImage, NoteLink
from apps.items.serializers import note_link_preview
from apps.items.titles import linkable_titles, note_title

from .handles import public_handle
from .models import Site
from .pages import author_name, public_image_url, site_author
from .sites import (
    current_site,
    is_app_host,
    normalize_hostname,
    public_urls,
    site_notes,
    site_url,
    verified_sites,
)
from .tasks import verify_site

# Long enough to spare the server, short enough that a note taken down stops
# showing its images soon, even through a cache in front.
IMAGE_MAX_AGE = 300


def published_notes(request):
    """Every published note on the server, or those of the blog being read."""
    if current_site(request):
        return site_notes(current_site(request))
    return Item.objects.filter(kind=Item.Kind.NOTE, published_at__isnull=False)


def published_note(request, handle, slug, queryset=None):
    queryset = queryset if queryset is not None else published_notes(request)
    return get_object_or_404(queryset, owner__profile__handle=handle, public_slug=slug)


def versioned(path, file):
    # The file name changes with the file, so it doubles as a cache buster.
    return f"{path}?v={file.name.rsplit('/', 1)[-1]}"


def public_images(note, handle):
    """The note's stored images, by `src`, at their public addresses."""
    images = {}
    for image in note.note_images.all():
        url = public_image_url(note, image, handle) if image.image else None
        images[image.src] = {"status": image.status, "url": url}
    return images


def public_links(note, handle):
    """The previews of its card and embed links, with their images made public."""
    links = {}
    for link in note.note_links.all():
        preview = note_link_preview(link)
        if link.image:
            path = reverse(
                "public-note-link-image", args=[handle, note.public_slug, link.id]
            )
            preview["image_url"] = versioned(path, link.image)
        links[link.url] = preview
    return links


def linked_notes(request, note):
    """
    The titles `[[Title]]` finds the owner's published notes by, as
    `[{"url", "title"}]`. Links are resolved against all of the owner's
    notes first (see `linkable_titles`): a title that finds a private note
    is left out, so the link reads as plain text and never leads anywhere else.
    On a blog, so is a note with no address there (see `public_urls`).
    """
    notes = list(
        Item.objects.filter(owner_id=note.owner_id, kind=Item.Kind.NOTE)
        .only("id", "owner_id", "title", "body", "public_slug", "published_at")
        .order_by("created_at")
    )
    by_id = {candidate.id: candidate for candidate in notes}
    seen = set()
    targets = []
    for note_id, title in linkable_titles(notes):
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        target = by_id[note_id]
        if target.published_at:
            targets.append((target, title))
    urls = public_urls([target for target, _ in targets], current_site(request))
    return [
        {"url": urls[target.id], "title": title}
        for target, title in targets
        if urls[target.id]
    ]


class PublicNoteListView(generics.ListAPIView):
    """
    `/p/`: every published note on the server, the last published first; on
    a blog, its notes. Each with its address.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get_queryset(self):
        return (
            published_notes(self.request)
            .only("id", "owner_id", "title", "body", "public_slug", "published_at")
            .order_by("-published_at")
        )

    def list(self, request, *args, **kwargs):
        notes = self.paginate_queryset(self.get_queryset())
        urls = public_urls(notes, current_site(request))
        return self.get_paginated_response(
            [
                {
                    "slug": note.public_slug,
                    "title": note.title or note_title(note.body),
                    "published_at": note.published_at,
                    "url": urls[note.id],
                }
                for note in notes
            ]
        )


class PublicNoteView(APIView):
    """
    One published note: its Markdown, with its images, link previews, the
    published notes its `[[links]]` lead to and its author's display name.
    Never the owner's account, its collections or anything else about it.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, handle, slug):
        note = published_note(
            request,
            handle,
            slug,
            published_notes(request).prefetch_related("note_images", "note_links"),
        )
        return Response(
            {
                "slug": note.public_slug,
                "handle": handle,
                "title": note.title or note_title(note.body),
                "body": note.body,
                "published_at": note.published_at,
                "edited_at": note.edited_at,
                # The owner's display name, never their username; "" without one.
                "author": author_name(note),
                "images": public_images(note, handle),
                "links": public_links(note, handle),
                "notes": linked_notes(request, note),
            }
        )


class LegacyPublicNoteView(APIView):
    """
    Where `/p/<slug>`, the address notes had before handles, lives now:
    `{url}`, while one published note has that slug.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, slug):
        notes = list(
            published_notes(request)
            .filter(public_slug=slug)
            .only("id", "owner_id", "public_slug")[:2]
        )
        if len(notes) != 1:
            raise Http404
        return Response({"url": public_urls(notes)[notes[0].id]})


def image_response(file):
    if not file:
        raise Http404
    response = FileResponse(file.open("rb"), content_type="image/webp")
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = f"public, max-age={IMAGE_MAX_AGE}"
    return response


class PublicNoteImageView(APIView):
    """An image of a published note: only its own, only while it is published."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, handle, slug, image_id):
        note = published_note(request, handle, slug)
        image = get_object_or_404(NoteImage, id=image_id, note=note)
        return image_response(image.image)


class PublicNoteLinkImageView(APIView):
    """The image of a card link in a published note."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, handle, slug, link_id):
        note = published_note(request, handle, slug)
        link = get_object_or_404(NoteLink, id=link_id, note=note)
        return image_response(link.image)


class PublicSiteView(APIView):
    """The blog being read: its name, blurb, author and handle. 404 off a blog."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        site = current_site(request)
        if site is None:
            raise Http404
        return Response(
            {
                "hostname": site.hostname,
                "title": site.name,
                "description": site.description,
                "author": site_author(site),
                "handle": public_handle(site.owner_id),
            }
        )


class SiteCheckView(APIView):
    """
    `?domain=<hostname>`: 200 if it is a verified blog's, 404 otherwise. A
    reverse proxy that issues certificates on demand (Caddy's `ask`) asks
    this before getting one, so it never gets one for a domain nobody added.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        hostname = normalize_hostname(request.query_params.get("domain", ""))
        if not hostname or not verified_sites().filter(hostname=hostname).exists():
            raise Http404
        return HttpResponse(status=200)


class SiteSerializer(serializers.ModelSerializer):
    # Checked by hand: it is normalized first, and unique once verified only.
    hostname = serializers.CharField(max_length=253)
    collection = serializers.PrimaryKeyRelatedField(
        queryset=Collection.objects.none(), allow_null=True, required=False
    )
    url = serializers.SerializerMethodField()
    records = serializers.SerializerMethodField()

    class Meta:
        model = Site
        fields = [
            "id",
            "hostname",
            "collection",
            "title",
            "description",
            "status",
            "checked_at",
            "verified_at",
            "url",
            "records",
            "created_at",
        ]
        read_only_fields = ["status", "checked_at", "verified_at", "created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None:
            self.fields["collection"].queryset = Collection.objects.filter(
                owner=request.user
            )

    def validate_hostname(self, value):
        hostname = normalize_hostname(value)
        if not hostname:
            raise serializers.ValidationError("Enter a domain, like blog.example.com.")
        if is_app_host(hostname):
            raise serializers.ValidationError("This is BrainBro's own address.")
        user = self.context["request"].user
        others = Site.objects.filter(hostname=hostname)
        if self.instance is not None:
            others = others.exclude(pk=self.instance.pk)
        if others.filter(owner=user).exists():
            raise serializers.ValidationError("You already have a blog on this domain.")
        if others.filter(status=Site.Status.VERIFIED).exists():
            raise serializers.ValidationError("Another blog already uses this domain.")
        return hostname

    def get_url(self, site):
        return site_url(site)

    def get_records(self, site):
        """The DNS records its owner adds: where it points, and the proof."""
        request = self.context["request"]
        target = settings.SITE_CNAME_TARGET or request.get_host().split(":")[0]
        records = [{"type": "CNAME", "name": site.hostname, "value": target}]
        # Root domains can't have a CNAME at many DNS providers.
        if settings.SITE_IPV4:
            records.append(
                {"type": "A", "name": site.hostname, "value": settings.SITE_IPV4}
            )
        records.append(
            {
                "type": "TXT",
                "name": site.verification_name,
                "value": site.verification_value,
            }
        )
        return records

    def update(self, instance, validated_data):
        # A new domain has to be verified again.
        if validated_data.get("hostname", instance.hostname) != instance.hostname:
            instance.status = Site.Status.UNVERIFIED
            instance.checked_at = None
            instance.verified_at = None
        return super().update(instance, validated_data)


class SiteViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """The user's blogs on their own domains."""

    serializer_class = SiteSerializer
    pagination_class = None

    def get_queryset(self):
        return Site.objects.filter(owner=self.request.user).select_related("collection")

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        """Looks the TXT record up (in the worker); the site says how it went."""
        site = self.get_object()
        site.status = Site.Status.CHECKING
        site.save(update_fields=["status", "updated_at"])
        verify_site.delay(str(site.id))
        site.refresh_from_db()
        return Response(self.get_serializer(site).data, status=status.HTTP_202_ACCEPTED)
