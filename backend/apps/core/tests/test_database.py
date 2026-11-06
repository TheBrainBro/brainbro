import pytest
from django.db import connection


@pytest.mark.django_db
def test_connections_come_from_a_pool():
    """Persistent connections pile up under ASGI; a capped pool reuses them."""
    connection.ensure_connection()
    assert connection.pool is not None
    assert connection.pool.max_size == 10
    assert connection.settings_dict["CONN_MAX_AGE"] == 0
