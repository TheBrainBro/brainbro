import pytest
from django.db import IntegrityError

from apps.items.models import Collection, Item
from apps.items.serializers import CollectionSerializer, ItemSerializer


def test_item_defaults_to_inbox(user):
    item = Item.objects.create(owner=user, kind=Item.Kind.NOTE, body="hello")
    assert item.status == Item.Status.INBOX
    assert item.preview_status == Item.PreviewStatus.NONE
    assert item.metadata == {}
    assert str(item) == "hello"


def test_items_are_newest_first(user):
    first = Item.objects.create(owner=user, kind=Item.Kind.NOTE, body="1")
    second = Item.objects.create(owner=user, kind=Item.Kind.NOTE, body="2")
    assert list(Item.objects.all()) == [second, first]


def test_item_belongs_to_several_collections(user):
    work = Collection.objects.create(owner=user, name="Work", kind="project")
    reading = Collection.objects.create(owner=user, name="Reading")
    item = Item.objects.create(owner=user, kind=Item.Kind.LINK, url="https://a.io")
    item.collections.set([work, reading])
    assert set(work.items.all()) == {item}
    assert item.collections.count() == 2


def test_collections_default_to_resource(user):
    collection = Collection.objects.create(owner=user, name="Cooking")
    assert collection.kind == Collection.Kind.RESOURCE


def test_collection_names_are_unique_per_owner(user, other_user):
    Collection.objects.create(owner=user, name="Work")
    Collection.objects.create(owner=other_user, name="Work")
    with pytest.raises(IntegrityError):
        Collection.objects.create(owner=user, name="Work")


def test_item_serializer_rejects_other_users_collections(user, other_user, context):
    mine = Collection.objects.create(owner=user, name="Mine")
    theirs = Collection.objects.create(owner=other_user, name="Theirs")
    item = Item.objects.create(owner=user, kind=Item.Kind.NOTE, body="x")

    ok = ItemSerializer(
        item, data={"collections": [mine.id]}, partial=True, context=context
    )
    assert ok.is_valid(), ok.errors

    bad = ItemSerializer(
        item, data={"collections": [theirs.id]}, partial=True, context=context
    )
    assert not bad.is_valid()
    assert "collections" in bad.errors


def test_item_serializer_keeps_capture_fields_read_only(user, context):
    item = Item.objects.create(owner=user, kind=Item.Kind.NOTE, body="x")
    serializer = ItemSerializer(
        item,
        data={"kind": "link", "url": "https://evil.io", "title": "New"},
        partial=True,
        context=context,
    )
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    item.refresh_from_db()
    assert (item.kind, item.url, item.title) == ("note", "", "New")


@pytest.mark.parametrize(
    "color,valid", [("#3B82F6", True), ("", True), ("blue", False), ("#12345", False)]
)
def test_collection_serializer_validates_color(context, color, valid):
    serializer = CollectionSerializer(
        data={"name": "Work", "color": color}, context=context
    )
    assert serializer.is_valid() is valid


def test_collection_serializer_rejects_duplicate_name(user, context):
    Collection.objects.create(owner=user, name="Work")
    serializer = CollectionSerializer(data={"name": "work"}, context=context)
    assert not serializer.is_valid()
    assert "name" in serializer.errors
