import pytest
from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command

pytestmark = pytest.mark.django_db

User = get_user_model()


def test_creates_the_admin(monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_PASSWORD", "a long password")

    call_command("ensure_admin")

    admin = User.objects.get(username="admin")
    assert admin.is_superuser
    assert admin.check_password("a long password")


def test_the_example_password_is_refused(monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_PASSWORD", "CHANGE_ME")

    with pytest.raises(CommandError, match="ADMIN_PASSWORD"):
        call_command("ensure_admin")

    assert not User.objects.exists()


def test_an_existing_admin_is_left_alone(monkeypatch):
    User.objects.create_superuser(username="admin", password="changed in admin")
    monkeypatch.setenv("ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_PASSWORD", "CHANGE_ME")

    call_command("ensure_admin")

    assert User.objects.get(username="admin").check_password("changed in admin")
