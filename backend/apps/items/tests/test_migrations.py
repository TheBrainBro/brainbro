from django.db import connection
from django.db.migrations.executor import MigrationExecutor


def migrate_to(target):
    executor = MigrationExecutor(connection)
    executor.migrate([target])
    executor.loader.build_graph()
    return executor.loader.project_state([target]).apps


def test_personal_collections_become_resources(transactional_db, user):
    old = migrate_to(("items", "0001_initial"))
    Collection = old.get_model("items", "Collection")
    Collection.objects.create(owner_id=user.id, name="Home", kind="personal")
    Collection.objects.create(owner_id=user.id, name="Work", kind="project")

    new = migrate_to(("items", "0002_collection_kind_para"))
    Collection = new.get_model("items", "Collection")
    kinds = dict(Collection.objects.values_list("name", "kind"))
    assert kinds == {"Home": "resource", "Work": "project"}


def test_ranks_keep_the_newest_first_order(transactional_db, user):
    old = migrate_to(("items", "0007_collection_image"))
    Item = old.get_model("items", "Item")
    Collection = old.get_model("items", "Collection")
    work = Collection.objects.create(owner_id=user.id, name="Work")
    first = Item.objects.create(owner_id=user.id, kind="note", body="first")
    second = Item.objects.create(owner_id=user.id, kind="note", body="second")
    first.collections.add(work)
    second.collections.add(work)

    new = migrate_to(("items", "0008_ranks"))
    Item = new.get_model("items", "Item")
    CollectionItem = new.get_model("items", "CollectionItem")
    inbox = list(Item.objects.order_by("-inbox_rank").values_list("body", flat=True))
    assert inbox == ["second", "first"]
    in_work = CollectionItem.objects.filter(collection_id=work.id).order_by("-rank")
    assert [link.item.body for link in in_work] == ["second", "first"]
    second = Item.objects.get(body="second")
    assert second.inbox_rank == second.created_at.timestamp()


def test_collection_ranks_keep_the_order_by_name(transactional_db, user):
    old = migrate_to(("items", "0011_unplaced_back_to_inbox"))
    Collection = old.get_model("items", "Collection")
    for name in ("Work", "Home", "Books"):
        Collection.objects.create(owner_id=user.id, name=name)

    new = migrate_to(("items", "0012_collection_rank"))
    Collection = new.get_model("items", "Collection")
    names = list(Collection.objects.order_by("-rank").values_list("name", flat=True))
    assert names == ["Books", "Home", "Work"]
