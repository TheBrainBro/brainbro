import shutil

import pytest
from django.db import connection

from apps.core.tasks import backup_database

pytestmark = pytest.mark.skipif(
    shutil.which("pg_dump") is None, reason="pg_dump not installed"
)


@pytest.mark.django_db
def test_backup_database_writes_dump_and_applies_retention(settings, tmp_path):
    settings.BACKUP_DIR = tmp_path
    settings.BACKUP_RETENTION = 2
    # Back up the test database, which is the one that actually exists.
    settings.DATABASES["default"]["NAME"] = connection.settings_dict["NAME"]
    name = connection.settings_dict["NAME"]

    old = [tmp_path / f"{name}-2000010{i}-000000.dump" for i in range(1, 4)]
    for path in old:
        path.write_bytes(b"old")

    target = backup_database()

    dumps = sorted(tmp_path.glob(f"{name}-*.dump"))
    assert [p.name for p in dumps] == [old[2].name, target.rsplit("/", 1)[1]]
    assert (tmp_path / target.rsplit("/", 1)[1]).read_bytes().startswith(b"PGDMP")
    assert not list(tmp_path.glob("*.partial"))
