import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse

from apps.accounts.models import OAuthClient, Profile

pytestmark = pytest.mark.django_db

User = get_user_model()


@pytest.fixture
def admin_client(client):
    admin = User.objects.create_superuser(username="admin", password="pw")
    client.force_login(admin)
    return client


def test_only_the_storage_quota_changes_on_a_profile(admin_client, user):
    profile = Profile.objects.create(user=user, display_name="Ana")
    url = reverse("admin:accounts_profile_change", args=[profile.pk])

    response = admin_client.post(
        url, {"storage_quota": "500", "display_name": "Changed", "theme": "dark"}
    )

    assert response.status_code == 302
    profile.refresh_from_db()
    assert profile.storage_quota == 500
    assert profile.display_name == "Ana"
    assert profile.theme == Profile.Theme.SYSTEM


@pytest.mark.parametrize("model", ["profile", "apitoken", "invitation", "oauthclient"])
def test_nothing_is_added_from_the_admin(admin_client, model):
    response = admin_client.get(reverse(f"admin:accounts_{model}_add"))

    assert response.status_code == 403


def test_an_oauth_client_can_be_seen_but_not_changed(admin_client):
    oauth_client = OAuthClient.objects.create(name="Claude")
    url = reverse("admin:accounts_oauthclient_change", args=[oauth_client.pk])

    assert admin_client.get(url).status_code == 200
    assert admin_client.post(url, {"name": "Other"}).status_code == 403
    oauth_client.refresh_from_db()
    assert oauth_client.name == "Claude"


def test_an_oauth_client_can_still_be_deleted(admin_client):
    oauth_client = OAuthClient.objects.create(name="Claude")
    url = reverse("admin:accounts_oauthclient_delete", args=[oauth_client.pk])

    admin_client.post(url, {"post": "yes"})

    assert not OAuthClient.objects.exists()


def test_the_admin_shows_the_brainbro_logo(admin_client):
    response = admin_client.get(reverse("admin:index"))

    assert b"favicon.svg" in response.content
