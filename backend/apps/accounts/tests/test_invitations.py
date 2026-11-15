from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.utils import timezone

from apps.accounts.models import ApiToken, Invitation, Profile

PASSWORD = "a-long-new-pass"


@pytest.fixture
def admin_user(db):
    return get_user_model().objects.create_user(
        username="admin", password="pw", is_staff=True
    )


@pytest.fixture
def admin(admin_user):
    client = Client()
    client.force_login(admin_user)
    return client


@pytest.fixture
def invitation(admin_user):
    return Invitation.issue(admin_user, "Ana", timedelta(days=7))


def join(client, token, username="ana", password=PASSWORD):
    return client.post(
        f"/api/auth/join/{token}/",
        {"username": username, "password": password},
        content_type="application/json",
    )


def test_an_admin_makes_a_link_shown_once(admin, admin_user):
    response = admin.post(
        "/api/auth/invitations/", {"note": "Ana"}, content_type="application/json"
    )

    assert response.status_code == 201
    url = response.json()["url"]
    token = url.rsplit("/join/", 1)[1]
    assert url == f"http://testserver/join/{token}"
    invitation = Invitation.objects.get()
    assert invitation.created_by == admin_user
    assert invitation.token_hash == ApiToken.hash(token)
    assert invitation.expires_at > timezone.now() + timedelta(days=6)
    listed = admin.get("/api/auth/invitations/").json()
    assert [entry["note"] for entry in listed] == ["Ana"]
    assert "url" not in listed[0]


def test_every_invitation_is_listed_with_its_status(admin, admin_user, invitation):
    _, token = Invitation.issue(admin_user, "joined", timedelta(days=7))
    join(Client(), token, username="bea")
    Invitation.issue(admin_user, "expired", timedelta(days=-1))

    listed = {
        entry["note"]: entry for entry in admin.get("/api/auth/invitations/").json()
    }

    assert {note: entry["status"] for note, entry in listed.items()} == {
        "Ana": "pending",
        "joined": "accepted",
        "expired": "expired",
    }
    assert (listed["Ana"]["used_at"], listed["Ana"]["used_by"]) == (None, None)
    assert listed["joined"]["used_by"] == "bea"
    assert listed["joined"]["used_at"] is not None


def test_an_accepted_invitation_outlives_its_account(admin, invitation):
    join(Client(), invitation[1])
    get_user_model().objects.get(username="ana").delete()

    [entry] = admin.get("/api/auth/invitations/").json()

    assert (entry["status"], entry["used_by"]) == ("accepted", None)


def test_revoking_stops_the_link(admin, invitation):
    pending, token = invitation

    assert admin.delete(f"/api/auth/invitations/{pending.id}/").status_code == 204

    assert not Invitation.objects.exists()
    assert Client().get(f"/api/auth/join/{token}/").status_code == 404


def test_an_expired_invitation_can_be_removed(admin, admin_user):
    expired, _ = Invitation.issue(admin_user, "", timedelta(days=-1))

    assert admin.delete(f"/api/auth/invitations/{expired.id}/").status_code == 204

    assert not Invitation.objects.exists()


def test_an_accepted_invitation_stays(admin, invitation):
    accepted, token = invitation
    join(Client(), token)

    assert admin.delete(f"/api/auth/invitations/{accepted.id}/").status_code == 204

    assert Invitation.objects.filter(pk=accepted.pk).exists()


@pytest.mark.parametrize("method", ["get", "post"])
def test_only_admins_manage_invitations(user, method):
    client = Client()
    client.force_login(user)
    assert getattr(client, method)("/api/auth/invitations/").status_code == 403


def test_a_token_can_t_manage_invitations(admin_user):
    _, key = ApiToken.issue(admin_user, "Script")
    response = Client().get(
        "/api/auth/invitations/", HTTP_AUTHORIZATION=f"Bearer {key}"
    )
    assert response.status_code == 403


def test_a_user_can_t_revoke_invitations(user, invitation):
    client = Client()
    client.force_login(user)

    response = client.delete(f"/api/auth/invitations/{invitation[0].id}/")

    assert response.status_code == 403
    assert Invitation.objects.exists()


def test_joining_makes_the_account_and_signs_in(invitation):
    pending, token = invitation
    client = Client()

    assert client.get(f"/api/auth/join/{token}/").json() == {"valid": True, "email": ""}
    response = join(client, token)

    assert response.status_code == 201
    assert response.json()["user"]["username"] == "ana"
    assert response.json()["user"]["is_staff"] is False
    user = get_user_model().objects.get(username="ana")
    assert user.check_password(PASSWORD)
    pending.refresh_from_db()
    assert (pending.used_by, pending.used_at is not None) == (user, True)
    assert client.get("/api/auth/session/").json()["user"]["username"] == "ana"


def test_a_link_works_once(invitation):
    _, token = invitation
    join(Client(), token)

    assert Client().get(f"/api/auth/join/{token}/").status_code == 404
    response = join(Client(), token, username="someone")
    assert response.status_code == 404
    assert not get_user_model().objects.filter(username="someone").exists()


def test_an_expired_link_doesn_t_work(admin_user):
    _, token = Invitation.issue(admin_user, "", timedelta(seconds=-1))

    assert Client().get(f"/api/auth/join/{token}/").status_code == 404
    assert join(Client(), token).status_code == 404
    assert not get_user_model().objects.filter(username="ana").exists()


@pytest.mark.django_db
def test_an_unknown_link_doesn_t_work():
    assert Client().get("/api/auth/join/nope/").status_code == 404
    assert join(Client(), "nope").status_code == 404


def test_joining_needs_a_free_username(invitation, admin_user):
    response = join(Client(), invitation[1], username="ADMIN")

    assert response.status_code == 400
    assert response.json() == {"username": ["This username is taken."]}
    assert Invitation.find(invitation[1]) is not None


def test_a_username_taken_in_another_case_meanwhile_is_refused(invitation, monkeypatch):
    # Someone else joins as "Ana" between the first check and the account.
    monkeypatch.setattr(
        "apps.accounts.views.JoinSerializer.validate_username", lambda self, v: v
    )
    get_user_model().objects.create_user(username="Ana", password="pw")

    response = join(Client(), invitation[1], username="ana")

    assert response.status_code == 400
    assert response.json() == {"username": ["This username is taken."]}
    assert not get_user_model().objects.filter(username="ana").exists()
    assert Invitation.find(invitation[1]) is not None


def test_joining_needs_a_valid_username(invitation):
    response = join(Client(), invitation[1], username="not valid!")
    assert response.status_code == 400
    assert "username" in response.json()


def test_joining_needs_a_strong_password(invitation):
    response = join(Client(), invitation[1], password="12345678")

    assert response.status_code == 400
    assert "password" in response.json()
    assert Invitation.find(invitation[1]) is not None


def test_joining_requires_csrf(invitation):
    response = join(Client(enforce_csrf_checks=True), invitation[1])
    assert response.status_code == 403


def test_joining_can_set_an_email(invitation):
    _, token = invitation
    response = Client().post(
        f"/api/auth/join/{token}/",
        {"username": "ana", "password": PASSWORD, "email": "Ana@EXAMPLE.com"},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert get_user_model().objects.get(username="ana").email == "Ana@example.com"


def test_joining_refuses_an_email_already_in_use(admin_user, invitation):
    admin_user.email = "ana@example.com"
    admin_user.save()
    _, token = invitation

    response = Client().post(
        f"/api/auth/join/{token}/",
        {"username": "ana", "password": PASSWORD, "email": "ANA@example.com"},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert "email" in response.json()
    assert not get_user_model().objects.filter(username="ana").exists()


@pytest.fixture
def email_on(settings):
    settings.EMAIL_PROVIDER = "mailgun"
    settings.MAILGUN_API_KEY = "key-123"
    settings.MAILGUN_DOMAIN = "mail.example.com"
    settings.MAILGUN_REGION = "us"
    settings.EMAIL_FROM = ""


def invite(admin, **data):
    return admin.post(
        "/api/auth/invitations/",
        {"note": "Ana", **data},
        content_type="application/json",
    )


def test_an_invitation_can_be_emailed(admin, email_on, mailoutbox):
    response = invite(admin, email="Ana@EXAMPLE.com")

    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "Ana@example.com"
    assert data["email_sent"] is True
    [message] = mailoutbox
    assert message.to == ["Ana@example.com"]
    assert message.subject == "admin invited you to BrainBro"
    assert data["url"] in message.body
    assert "7 days" in message.body


def test_the_email_signs_with_the_admins_display_name(
    admin, admin_user, email_on, mailoutbox
):
    Profile.objects.create(user=admin_user, display_name="Carla")

    invite(admin, email="ana@example.com")

    assert mailoutbox[0].subject == "Carla invited you to BrainBro"


def test_the_join_page_gets_the_invited_email(admin, email_on):
    url = invite(admin, email="ana@example.com").json()["url"]
    token = url.rsplit("/join/", 1)[1]

    assert Client().get(f"/api/auth/join/{token}/").json() == {
        "valid": True,
        "email": "ana@example.com",
    }


def test_without_email_an_invitation_cant_be_emailed(admin, mailoutbox):
    response = invite(admin, email="ana@example.com")

    assert response.status_code == 400
    assert response.json() == {"email": ["Email isn't set up on this server."]}
    assert not Invitation.objects.exists()


def test_an_email_with_an_account_isnt_invited(admin, admin_user, email_on):
    admin_user.email = "ana@example.com"
    admin_user.save()

    response = invite(admin, email="ANA@example.com")

    assert response.status_code == 400
    assert "email" in response.json()


def test_a_failed_email_keeps_the_invitation_and_its_link(admin, email_on, monkeypatch):
    def refuse(*args, **kwargs):
        raise RuntimeError("Domain not verified")

    monkeypatch.setattr("apps.core.mail.send_mail", refuse)

    response = invite(admin, email="ana@example.com")

    assert response.status_code == 201
    data = response.json()
    assert data["url"]
    assert data["email_error"] == "The email couldn't be sent: Domain not verified"
    assert "email_sent" not in data
    assert Invitation.objects.count() == 1
