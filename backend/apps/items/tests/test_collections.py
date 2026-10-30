import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from apps.items.models import Collection, Item


def png(width=400, height=200):
    output = io.BytesIO()
    Image.new("RGB", (width, height), "teal").save(output, format="PNG")
    return SimpleUploadedFile("logo.png", output.getvalue(), content_type="image/png")


def organized(owner, *collections, status=Item.Status.ORGANIZED):
    item = Item.objects.create(owner=owner, kind="note", body="x", status=status)
    item.collections.set(collections)
    return item


@pytest.fixture
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def work(user):
    return Collection.objects.create(owner=user, name="Work")


def test_rename_a_collection(api, work):
    response = api.patch(f"/api/collections/{work.id}/", {"name": "Job"}, format="json")
    assert response.status_code == 200
    work.refresh_from_db()
    assert work.name == "Job"


def test_rename_refuses_a_name_in_use(api, user, work):
    Collection.objects.create(owner=user, name="Home")
    response = api.patch(
        f"/api/collections/{work.id}/", {"name": "home"}, format="json"
    )
    assert response.status_code == 400


@pytest.mark.parametrize(
    "choice,expected", [(None, "inbox"), ("inbox", "inbox"), ("archive", "archived")]
)
def test_deleting_a_collection_moves_items_only_in_it(
    api, user, work, choice, expected
):
    home = Collection.objects.create(owner=user, name="Home")
    alone = organized(user, work)
    shared = organized(user, work, home)
    archived = organized(user, work, status=Item.Status.ARCHIVED)

    query = f"?items={choice}" if choice else ""
    response = api.delete(f"/api/collections/{work.id}/{query}")
    assert response.status_code == 204
    assert not Collection.objects.filter(id=work.id).exists()

    for item in (alone, shared, archived):
        item.refresh_from_db()
    assert alone.status == expected
    assert (shared.status, list(shared.collections.all())) == ("organized", [home])
    assert archived.status == "archived"


def test_deleting_a_collection_can_delete_items_only_in_it(api, user, work):
    home = Collection.objects.create(owner=user, name="Home")
    alone = organized(user, work)
    archived = organized(user, work, status=Item.Status.ARCHIVED)
    shared = organized(user, work, home)

    assert api.delete(f"/api/collections/{work.id}/?items=delete").status_code == 204
    assert list(Item.objects.values_list("id", flat=True)) == [shared.id]
    assert not Item.objects.filter(id__in=[alone.id, archived.id]).exists()


def test_deleting_a_collection_rejects_unknown_choices(api, work):
    assert api.delete(f"/api/collections/{work.id}/?items=keep").status_code == 400
    assert Collection.objects.filter(id=work.id).exists()


def test_deleting_someone_elses_collection_is_not_found(api, other_user):
    theirs = Collection.objects.create(owner=other_user, name="Theirs")
    item = organized(other_user, theirs)
    assert api.delete(f"/api/collections/{theirs.id}/?items=delete").status_code == 404
    assert Item.objects.filter(id=item.id).exists()


def test_collection_image_is_cropped_square_and_served(api, work, media):
    response = api.post(
        f"/api/collections/{work.id}/image/", {"file": png()}, format="multipart"
    )
    assert response.status_code == 200
    url = response.json()["image_url"]
    assert url.startswith(f"/api/collections/{work.id}/image/?v=")

    served = api.get(url)
    assert served.status_code == 200
    assert served["Content-Type"] == "image/webp"
    with Image.open(io.BytesIO(b"".join(served.streaming_content))) as image:
        assert (image.format, image.size) == ("WEBP", (256, 256))


def test_replacing_and_removing_the_image_removes_old_files(api, work, media):
    api.post(f"/api/collections/{work.id}/image/", {"file": png()}, format="multipart")
    api.post(f"/api/collections/{work.id}/image/", {"file": png()}, format="multipart")
    assert len([p for p in media.rglob("*") if p.is_file()]) == 1

    response = api.delete(f"/api/collections/{work.id}/image/")
    assert response.json()["image_url"] is None
    assert not [p for p in media.rglob("*") if p.is_file()]


def test_collection_image_must_be_an_image(api, work, media):
    text = SimpleUploadedFile("a.png", b"not an image", content_type="image/png")
    response = api.post(
        f"/api/collections/{work.id}/image/", {"file": text}, format="multipart"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_collection_image_needs_authentication(work):
    assert APIClient().get(f"/api/collections/{work.id}/image/").status_code == 403


def test_a_collection_can_go_inside_another(api, user, work):
    clients = Collection.objects.create(owner=user, name="Clients")
    response = api.patch(
        f"/api/collections/{clients.id}/", {"parent": str(work.id)}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["parent"] == str(work.id)
    clients.refresh_from_db()
    assert clients.parent == work

    response = api.patch(
        f"/api/collections/{clients.id}/", {"parent": None}, format="json"
    )
    assert response.status_code == 200
    clients.refresh_from_db()
    assert clients.parent is None


def test_a_collection_can_be_created_inside_another(api, work):
    response = api.post(
        "/api/collections/", {"name": "Clients", "parent": str(work.id)}, format="json"
    )
    assert response.status_code == 201
    assert Collection.objects.get(name="Clients").parent == work


def test_a_collection_cant_go_inside_itself_or_its_own(api, user, work):
    clients = Collection.objects.create(owner=user, name="Clients", parent=work)
    acme = Collection.objects.create(owner=user, name="Acme", parent=clients)

    for parent in (work, acme):
        response = api.patch(
            f"/api/collections/{work.id}/", {"parent": str(parent.id)}, format="json"
        )
        assert response.status_code == 400
        assert "parent" in response.json()
    work.refresh_from_db()
    assert work.parent is None


def test_a_collection_cant_go_inside_someone_elses(api, work, django_user_model):
    other = django_user_model.objects.create_user(username="other", password="x")
    theirs = Collection.objects.create(owner=other, name="Theirs")
    response = api.patch(
        f"/api/collections/{work.id}/", {"parent": str(theirs.id)}, format="json"
    )
    assert response.status_code == 400


def test_deleting_a_collection_moves_its_children_up_a_level(api, user, work):
    clients = Collection.objects.create(owner=user, name="Clients", parent=work)
    acme = Collection.objects.create(owner=user, name="Acme", parent=clients)
    globex = Collection.objects.create(owner=user, name="Globex", parent=clients)
    deep = Collection.objects.create(owner=user, name="Contracts", parent=acme)

    assert api.delete(f"/api/collections/{clients.id}/").status_code == 204
    for collection in (acme, globex, deep):
        collection.refresh_from_db()
    assert (acme.parent, globex.parent, deep.parent) == (work, work, acme)

    assert api.delete(f"/api/collections/{work.id}/").status_code == 204
    acme.refresh_from_db()
    assert acme.parent is None
