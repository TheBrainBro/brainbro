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
