import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework.test import APIClient


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(username="carlos", password="pw")


@pytest.fixture
def other_user(db):
    return get_user_model().objects.create_user(username="other", password="pw")


@pytest.fixture
def api(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture(autouse=True)
def published(monkeypatch):
    """What tests tell open tabs, as (owner id, message): nothing reaches Redis."""
    messages = []
    monkeypatch.setattr(
        "apps.events.changes.publish",
        lambda owner_id, message: messages.append((owner_id, message)),
    )
    return messages


@pytest.fixture(autouse=True)
def relayed(monkeypatch):
    """What tests send to open notes, as (note id, kind, payload); not to Redis."""
    messages = []
    monkeypatch.setattr(
        "apps.collab.relay.publish",
        lambda note_id, kind, payload: messages.append((str(note_id), kind, payload)),
    )
    return messages


@pytest.fixture(autouse=True)
def no_attempts_yet():
    """Rate limits start from zero: tests all come from the same address."""
    cache.clear()


@pytest.fixture
def migrate_to(transactional_db):
    """
    Takes the database to a migration and returns its models. Afterwards it
    goes back to the latest: tests that run later need every app's tables.
    """

    def migrate(target):
        executor = MigrationExecutor(connection)
        executor.migrate([target])
        executor.loader.build_graph()
        return executor.loader.project_state([target]).apps

    yield migrate
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
