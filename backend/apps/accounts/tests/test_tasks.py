from datetime import timedelta

from django.utils import timezone

from apps.accounts.models import ApiToken, AuthorizationCode, OAuthClient
from apps.accounts.tasks import delete_unused_oauth_clients


def registered(name, days_ago=2):
    client = OAuthClient.objects.create(name=name)
    OAuthClient.objects.filter(id=client.id).update(
        created_at=timezone.now() - timedelta(days=days_ago)
    )
    return client


def code(user, client, expires_in):
    return AuthorizationCode.objects.create(
        owner=user,
        client=client,
        code_hash=f"hash-{client.id}",
        redirect_uri="https://chatgpt.com/connector/oauth/callback",
        code_challenge="challenge",
        expires_at=timezone.now() + expires_in,
    )


def test_unused_clients_are_deleted(user):
    abandoned = registered("Abandoned")
    expired_code = registered("Expired code")
    code(user, expired_code, timedelta(minutes=-5))
    connected = registered("Connected")
    ApiToken.issue(user, "Connected", client=connected)
    signing_in = registered("Signing in")
    code(user, signing_in, timedelta(minutes=5))
    registered("Recent", days_ago=0)

    delete_unused_oauth_clients()

    assert not OAuthClient.objects.filter(id=abandoned.id).exists()
    assert not OAuthClient.objects.filter(id=expired_code.id).exists()
    assert set(OAuthClient.objects.values_list("name", flat=True)) == {
        "Connected",
        "Signing in",
        "Recent",
    }
    assert not AuthorizationCode.objects.filter(client=expired_code.id).exists()


def test_a_disconnected_app_is_deleted(user):
    client = registered("Disconnected")
    ApiToken.issue(user, "Disconnected", client=client)[0].delete()

    delete_unused_oauth_clients()

    assert not OAuthClient.objects.exists()
