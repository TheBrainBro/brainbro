import pytest

from apps.items.models import Collection, Item


def image(owner, name="a.png"):
    return Item.objects.create(
        owner=owner, kind="image", metadata={"filename": name, "mime": "image/png"}
    )


@pytest.fixture
def images(user):
    return [image(user, f"{n}.png") for n in "abc"]


def ids(items):
    return [str(item.id) for item in items]


def make(api, items, **fields):
    return api.post(
        "/api/items/albums/", {"items": ids(items), **fields}, format="json"
    )


def test_an_album_holds_images_in_order_and_hides_them(api, images):
    response = make(api, [images[2], images[0]], title="Trip")
    assert response.status_code == 201
    album = response.json()
    assert (album["kind"], album["title"], album["status"]) == (
        "album",
        "Trip",
        "inbox",
    )
    assert [i["id"] for i in album["album_items"]] == ids([images[2], images[0]])
    assert album["album_items"][0]["album"] == album["id"]

    listed = [i["id"] for i in api.get("/api/items/").json()["results"]]
    assert album["id"] in listed
    assert str(images[0].id) not in listed and str(images[1].id) in listed
    # Its images still work on their own (the viewer, their files).
    assert api.get(f"/api/items/{images[0].id}/").status_code == 200


@pytest.mark.parametrize(
    "build,detail",
    [
        (lambda user, imgs: [imgs[0]], "at least two"),
        (
            lambda user, imgs: [imgs[0], Item.objects.create(owner=user, kind="note")],
            "Only images",
        ),
    ],
)
def test_album_needs_two_images(api, user, images, build, detail):
    response = make(api, build(user, images))
    assert response.status_code == 400
    assert detail in response.json()["detail"]


def test_album_takes_only_your_images_once(api, images, other_user):
    theirs = image(other_user)
    assert make(api, [images[0], theirs]).status_code == 400
    assert make(api, [images[0], images[0]]).status_code == 400
    assert make(api, images[:2]).status_code == 201
    response = make(api, images[1:])
    assert "another album" in response.json()["detail"]


def test_album_contents_reorder_add_and_remove(api, images):
    album = make(api, images[:2]).json()
    response = api.put(
        f"/api/items/{album['id']}/album-items/",
        {"items": ids([images[2], images[0]])},
        format="json",
    )
    assert response.status_code == 200
    assert [i["id"] for i in response.json()["album_items"]] == ids(
        [images[2], images[0]]
    )
    images[1].refresh_from_db()
    # Left out: on its own again, with the album's status.
    assert images[1].album is None and images[1].status == "inbox"


def test_ungroup_keeps_the_images(api, images):
    album = make(api, images[:2]).json()
    Item.objects.filter(id=album["id"]).update(status="organized")
    response = api.post(f"/api/items/{album['id']}/ungroup/")
    assert response.status_code == 200
    assert sorted(i["id"] for i in response.json()) == sorted(ids(images[:2]))
    assert not Item.objects.filter(id=album["id"]).exists()
    assert set(
        Item.objects.filter(id__in=ids(images[:2])).values_list("status", flat=True)
    ) == {"organized"}


def test_deleting_an_album_deletes_its_images(api, images):
    album = make(api, images[:2]).json()
    api.post(
        "/api/items/triage/", {"ids": [album["id"]], "action": "delete"}, format="json"
    )
    assert not Item.objects.filter(id__in=ids(images[:2])).exists()
    assert Item.objects.filter(id=images[2].id).exists()


def test_only_albums_have_contents(api, images):
    response = api.post(f"/api/items/{images[0].id}/ungroup/")
    assert response.status_code == 400


def test_an_album_of_images_in_a_collection_stays_there(api, user, images):
    work = Collection.objects.create(owner=user, name="Work")
    home = Collection.objects.create(owner=user, name="Home")
    for item in images[:2]:
        item.status = Item.Status.ORGANIZED
        item.save()
        item.collections.add(work)
    images[0].collections.add(home)

    album = make(api, images[:2]).json()
    assert (album["status"], album["collections"]) == ("organized", [str(work.id)])


def test_an_album_of_images_from_different_places_goes_to_the_inbox(api, user, images):
    work = Collection.objects.create(owner=user, name="Work")
    images[0].status = Item.Status.ORGANIZED
    images[0].save()
    images[0].collections.add(work)

    album = make(api, images[:2]).json()
    assert (album["status"], album["collections"]) == ("inbox", [])
