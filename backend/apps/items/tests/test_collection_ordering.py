import pytest

from apps.items.models import Collection


def names(api, parent=None):
    results = api.get("/api/collections/").json()["results"]
    return [
        c["name"]
        for c in results
        if c["parent"] == (str(parent.id) if parent else None)
    ]


def move(api, collection, parent=None, after=None):
    return api.post(
        f"/api/collections/{collection.id}/move/",
        {
            "parent": str(parent.id) if parent else None,
            "after": str(after.id) if after else None,
        },
        format="json",
    )


@pytest.fixture
def top(user):
    # Created in this order: newest first, so c, b, a.
    return [Collection.objects.create(owner=user, name=name) for name in "abc"]


def test_new_collections_land_on_top(api, top):
    assert names(api) == ["c", "b", "a"]
    api.post("/api/collections/", {"name": "d"}, format="json")
    assert names(api) == ["d", "c", "b", "a"]


def test_move_among_siblings(api, top):
    a, b, c = top
    assert move(api, c, after=a).status_code == 204
    assert names(api) == ["b", "a", "c"]
    assert move(api, a).status_code == 204
    assert names(api) == ["a", "b", "c"]


def test_move_inside_another_collection(api, top):
    a, b, c = top
    inner = Collection.objects.create(owner=a.owner, name="inner", parent=a)
    assert move(api, c, parent=a, after=inner).status_code == 204
    assert names(api) == ["b", "a"]
    assert names(api, parent=a) == ["inner", "c"]
    assert move(api, b, parent=a).status_code == 204
    assert names(api, parent=a) == ["b", "inner", "c"]

    assert move(api, inner, after=a).status_code == 204
    assert names(api) == ["a", "inner"]
    assert names(api, parent=a) == ["b", "c"]


def test_move_refuses_loops(api, top):
    a, b, c = top
    inner = Collection.objects.create(owner=a.owner, name="inner", parent=a)
    assert move(api, a, parent=a).status_code == 400
    response = move(api, a, parent=inner)
    assert response.status_code == 400
    assert "parent" in response.json()
    assert Collection.objects.get(id=a.id).parent is None


def test_move_refuses_other_lists(api, user, top, other_user):
    a, b, c = top
    inner = Collection.objects.create(owner=user, name="inner", parent=a)
    # `inner` isn't at the top.
    assert move(api, b, after=inner).status_code == 400
    assert Collection.objects.get(id=b.id).parent is None
    theirs = Collection.objects.create(owner=other_user, name="theirs")
    assert move(api, theirs).status_code == 404
    assert move(api, b, parent=theirs).status_code == 400


def test_a_new_parent_puts_it_on_top_there(api, top):
    a, b, c = top
    Collection.objects.create(owner=a.owner, name="inner", parent=a)
    response = api.patch(
        f"/api/collections/{b.id}/", {"parent": str(a.id)}, format="json"
    )
    assert response.status_code == 200
    assert names(api, parent=a) == ["b", "inner"]


def test_renaming_keeps_its_place(api, top):
    a, b, c = top
    api.patch(f"/api/collections/{b.id}/", {"name": "z"}, format="json")
    assert names(api) == ["c", "z", "a"]
