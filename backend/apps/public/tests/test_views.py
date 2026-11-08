import pytest
from django.core.files.base import ContentFile
from rest_framework.test import APIClient

from apps.accounts.models import Profile
from apps.items.models import Item, NoteImage, NoteLink
from apps.public.publishing import publish, unpublish


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


@pytest.fixture
def anyone():
    return APIClient()


def note(user, title="", body="text"):
    return Item.objects.create(owner=user, kind=Item.Kind.NOTE, title=title, body=body)


def stored_image(item, src):
    image = NoteImage.objects.create(
        owner=item.owner, note=item, source=NoteImage.Source.REMOTE, src=src
    )
    image.image.save("image.webp", ContentFile(b"img"))
    return image


# Publishing, as the owner


def test_publishing_gives_the_note_an_address(api, user):
    item = note(user, title="Trip plan")

    response = api.put(f"/api/items/{item.id}/publication/", {}, format="json")

    assert response.status_code == 200
    assert response.json()["public_slug"] == "trip-plan"
    assert response.json()["published_at"]


def page(api, item, **changes):
    return api.patch(f"/api/items/{item.id}/page/", changes, format="json")


def test_the_slug_can_be_changed(api, user):
    item = publish(note(user, title="Trip plan"))

    response = page(api, item, slug="japan-2026")

    assert response.status_code == 200
    assert response.json()["slug"] == "japan-2026"
    item.refresh_from_db()
    assert item.public_slug == "japan-2026"


def test_a_slug_in_use_is_refused(api, user):
    publish(note(user, title="Plan"))
    item = publish(note(user))

    response = page(api, item, slug="plan")

    assert response.status_code == 400
    assert response.json() == {"slug": "Another note already has this address."}


def test_someone_else_s_slug_is_free(api, user, other_user):
    publish(note(other_user, title="Plan"))
    item = publish(note(user))

    response = page(api, item, slug="plan")

    assert response.status_code == 200
    # They published first, so they got "author".
    assert response.json()["address"] == "/@author-2/"


def test_a_slug_must_be_an_address(api, user):
    item = publish(note(user))

    response = page(api, item, slug="Trip plan")

    assert response.status_code == 400
    assert "slug" in response.json()


def test_page_settings_show_their_defaults(api, user):
    item = publish(note(user, body="# Trip\n\nTen days in **Japan**."))
    stored_image(item, "https://x/a.png")
    item.body += "\n\n![a](https://x/a.png)"
    item.save()

    data = api.get(f"/api/items/{item.id}/page/").json()

    assert data["title"] == ""
    assert data["defaults"] == {
        "title": "Trip",
        "description": "Ten days in Japan.",
        "image": "https://x/a.png",
    }
    assert data["preview"]["title"] == "Trip"
    assert data["preview"]["image_url"].startswith("/api/note-images/")


def test_page_settings_replace_the_defaults(api, user):
    item = publish(note(user, title="Trip", body="text"))
    stored_image(item, "https://x/a.png")

    data = page(api, item, title="Japan", description="Ten days", image="none").json()

    assert data["preview"] == {
        "title": "Japan",
        "description": "Ten days",
        "image_url": None,
    }

    data = page(api, item, title="").json()

    assert data["preview"]["title"] == "Trip"


def test_unpublishing_takes_it_down(api, anyone, user):
    item = publish(note(user, title="Plan"))

    response = api.delete(f"/api/items/{item.id}/publication/")

    assert response.status_code == 200
    assert response.json()["published_at"] is None
    assert anyone.get("/api/public/notes/author/plan/").status_code == 404


def test_only_notes_are_published(api, user):
    link = Item.objects.create(owner=user, kind=Item.Kind.LINK, url="https://x.com")

    response = api.put(f"/api/items/{link.id}/publication/", {}, format="json")

    assert response.status_code == 400


# Reading, as anyone


def test_anyone_reads_a_published_note(anyone, user):
    item = publish(note(user, title="Plan", body="# Plan\nSteps"))

    response = anyone.get("/api/public/notes/author/plan/")

    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Plan"
    assert data["body"] == "# Plan\nSteps"
    assert data["slug"] == "plan"
    # Nothing that says who owns it or where it is filed.
    assert set(data) == {
        "slug",
        "handle",
        "title",
        "body",
        "published_at",
        "edited_at",
        "author",
        "images",
        "links",
        "notes",
    }
    assert str(item.id) not in response.content.decode()


def test_the_author_is_the_display_name_never_the_username(anyone, user):
    publish(note(user, title="Plan"))

    assert anyone.get("/api/public/notes/author/plan/").json()["author"] == ""

    Profile.objects.filter(user=user).update(display_name="Carlos Lugones")
    response = anyone.get("/api/public/notes/author/plan/")

    assert response.json()["author"] == "Carlos Lugones"
    assert user.username not in response.content.decode()


def test_notes_never_published_are_not_found(anyone, user):
    note(user, title="Plan")

    assert anyone.get("/api/public/notes/author/plan/").status_code == 404


def test_the_index_lists_published_notes_last_first(anyone, user, other_user):
    first = publish(note(user, title="First"))
    publish(note(other_user, body="# Second\nmore"))
    unpublish(publish(note(user, title="Taken down")))
    note(user, title="Private")

    response = anyone.get("/api/public/notes/")

    assert response.status_code == 200
    results = response.json()["results"]
    assert [entry["title"] for entry in results] == ["Second", "First"]
    assert results[1] == {
        "slug": "first",
        "title": "First",
        "published_at": first.published_at.isoformat().replace("+00:00", "Z"),
        "url": "/@author/first",
    }
    assert results[0]["url"] == "/@author-2/second"


def test_links_lead_only_to_published_notes(anyone, user, other_user):
    publish(note(user, title="Public"))
    note(user, title="Private")
    publish(note(other_user, title="Theirs"))
    page = publish(note(user, title="Page", body="[[Public]] [[Private]] [[Theirs]]"))

    data = anyone.get(f"/api/public/notes/author/{page.public_slug}/").json()

    assert {"url": "/@author/public", "title": "Public"} in data["notes"]
    titles = [entry["title"] for entry in data["notes"]]
    assert "Private" not in titles
    assert "Theirs" not in titles


def test_a_title_that_finds_a_private_note_leads_nowhere(anyone, user):
    # Both are "Plan": links find the private one, made first.
    note(user, title="Plan")
    publish(note(user, title="Plan"))
    page = publish(note(user, title="Page", body="[[Plan]]"))

    data = anyone.get(f"/api/public/notes/author/{page.public_slug}/").json()

    assert "Plan" not in [entry["title"] for entry in data["notes"]]


# Images


def test_a_published_note_s_images_are_public(anyone, user):
    item = publish(note(user, title="Plan", body="![a](https://x/a.png)"))
    image = stored_image(item, "https://x/a.png")

    data = anyone.get("/api/public/notes/author/plan/").json()
    url = data["images"]["https://x/a.png"]["url"]

    assert url.startswith(f"/api/public/notes/author/plan/images/{image.id}/")
    response = anyone.get(url)
    assert response.status_code == 200
    assert response["Cache-Control"] == "public, max-age=300"
    assert b"".join(response.streaming_content) == b"img"


def test_card_images_are_public_too(anyone, user):
    item = publish(note(user, title="Plan"))
    link = NoteLink.objects.create(owner=user, note=item, url="https://x/")
    link.image.save("image.webp", ContentFile(b"img"))

    data = anyone.get("/api/public/notes/author/plan/").json()
    url = data["links"]["https://x/"]["image_url"]

    assert url.startswith(f"/api/public/notes/author/plan/links/{link.id}/image/")
    assert anyone.get(url).status_code == 200


def test_images_stop_being_public_when_the_note_is_taken_down(anyone, user):
    item = publish(note(user, title="Plan"))
    image = stored_image(item, "https://x/a.png")
    unpublish(item)

    response = anyone.get(f"/api/public/notes/author/plan/images/{image.id}/")

    assert response.status_code == 404


def test_other_notes_images_are_not_served_through_a_public_one(anyone, user):
    publish(note(user, title="Plan"))
    private = stored_image(note(user, title="Private"), "https://x/a.png")

    response = anyone.get(f"/api/public/notes/author/plan/images/{private.id}/")

    assert response.status_code == 404
