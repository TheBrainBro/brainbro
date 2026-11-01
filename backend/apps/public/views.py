"""
What anyone can read, signed in or not: published notes and their images.
Nothing else of a note's owner is reachable from here, and a note taken down
answers 404 at once, as if it never existed.
"""

from django.http import FileResponse, Http404
from django.urls import reverse
from rest_framework import generics, serializers
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.items.models import Item, NoteImage, NoteLink
from apps.items.serializers import note_link_preview
from apps.items.titles import linkable_titles, note_title

from .pages import author_name, public_image_url

# Long enough to spare the server, short enough that a note taken down stops
# showing its images soon, even through a cache in front.
IMAGE_MAX_AGE = 300


def published_notes():
    return Item.objects.filter(kind=Item.Kind.NOTE, published_at__isnull=False)


def published_note(slug):
    return get_object_or_404(published_notes(), public_slug=slug)


def versioned(path, file):
    # The file name changes with the file, so it doubles as a cache buster.
    return f"{path}?v={file.name.rsplit('/', 1)[-1]}"


def public_images(note):
    """The note's stored images, by `src`, at their public addresses."""
    images = {}
    for image in note.note_images.all():
        url = public_image_url(note, image) if image.image else None
        images[image.src] = {"status": image.status, "url": url}
    return images


def public_links(note):
    """The previews of its card and embed links, with their images made public."""
    links = {}
    for link in note.note_links.all():
        preview = note_link_preview(link)
        if link.image:
            path = reverse("public-note-link-image", args=[note.public_slug, link.id])
            preview["image_url"] = versioned(path, link.image)
        links[link.url] = preview
    return links


def linked_notes(note):
    """
    The titles `[[Title]]` finds the owner's published notes by, as
    `[{"slug", "title"}]`. Links are resolved against all of the owner's
    notes first (see `linkable_titles`): a title that finds a private note
    is left out, so the link reads as plain text and never leads anywhere else.
    """
    notes = list(
        Item.objects.filter(owner_id=note.owner_id, kind=Item.Kind.NOTE)
        .only("id", "title", "body", "public_slug", "published_at")
        .order_by("created_at")
    )
    by_id = {candidate.id: candidate for candidate in notes}
    seen = set()
    found = []
    for note_id, title in linkable_titles(notes):
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        target = by_id[note_id]
        if target.published_at:
            found.append({"slug": target.public_slug, "title": title})
    return found


class PublicNoteSummarySerializer(serializers.ModelSerializer):
    slug = serializers.CharField(source="public_slug")
    title = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = ["slug", "title", "published_at"]

    def get_title(self, note):
        return note.title or note_title(note.body)


class PublicNoteListView(generics.ListAPIView):
    """`/p/`: every published note on the server, the last published first."""

    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = PublicNoteSummarySerializer

    def get_queryset(self):
        return (
            published_notes()
            .only("id", "title", "body", "public_slug", "published_at")
            .order_by("-published_at")
        )


class PublicNoteView(APIView):
    """
    One published note: its Markdown, with its images, link previews, the
    published notes its `[[links]]` lead to and its author's display name.
    Never the owner's account, its collections or anything else about it.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, slug):
        note = get_object_or_404(
            published_notes().prefetch_related("note_images", "note_links"),
            public_slug=slug,
        )
        return Response(
            {
                "slug": note.public_slug,
                "title": note.title or note_title(note.body),
                "body": note.body,
                "published_at": note.published_at,
                "edited_at": note.edited_at,
                # The owner's display name, never their username; "" without one.
                "author": author_name(note),
                "images": public_images(note),
                "links": public_links(note),
                "notes": linked_notes(note),
            }
        )


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

    def get(self, request, slug, image_id):
        note = published_note(slug)
        image = get_object_or_404(NoteImage, id=image_id, note=note)
        return image_response(image.image)


class PublicNoteLinkImageView(APIView):
    """The image of a card link in a published note."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, slug, link_id):
        note = published_note(slug)
        link = get_object_or_404(NoteLink, id=link_id, note=note)
        return image_response(link.image)
