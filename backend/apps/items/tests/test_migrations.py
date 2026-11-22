def test_personal_collections_become_resources(migrate_to, user):
    old = migrate_to(("items", "0001_initial"))
    Collection = old.get_model("items", "Collection")
    Collection.objects.create(owner_id=user.id, name="Home", kind="personal")
    Collection.objects.create(owner_id=user.id, name="Work", kind="project")

    new = migrate_to(("items", "0002_collection_kind_para"))
    Collection = new.get_model("items", "Collection")
    kinds = dict(Collection.objects.values_list("name", "kind"))
    assert kinds == {"Home": "resource", "Work": "project"}


def test_ranks_keep_the_newest_first_order(migrate_to, user):
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


def test_collection_ranks_keep_the_order_by_name(migrate_to, user):
    old = migrate_to(("items", "0011_unplaced_back_to_inbox"))
    Collection = old.get_model("items", "Collection")
    for name in ("Work", "Home", "Books"):
        Collection.objects.create(owner_id=user.id, name=name)

    new = migrate_to(("items", "0012_collection_rank"))
    Collection = new.get_model("items", "Collection")
    names = list(Collection.objects.order_by("-rank").values_list("name", flat=True))
    assert names == ["Books", "Home", "Work"]


def test_old_pdf_indexes_are_rebuilt_with_the_mixed_page_extractor(migrate_to, user):
    old = migrate_to(("items", "0023_file_content_search"))
    Item = old.get_model("items", "Item")
    Index = old.get_model("items", "FileIndex")
    for mime, source in [("application/pdf", "scan.pdf"), ("audio/mpeg", "talk.mp3")]:
        item = Item.objects.create(
            owner_id=user.id, kind="file", file=source, metadata={"mime": mime}
        )
        Index.objects.create(item=item, source=source)
    new = migrate_to(("items", "0024_content_search_checkpoints"))
    Index = new.get_model("items", "FileIndex")
    assert set(Index.objects.values_list("source", "cursor", "attempts")) == {
        ("", 0, 0),
        ("talk.mp3", 0, 0),
    }
