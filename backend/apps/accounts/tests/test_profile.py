import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.accounts.models import Profile


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


def png(size=(400, 300)):
    output = io.BytesIO()
    Image.new("RGB", size, "red").save(output, format="PNG")
    return SimpleUploadedFile("me.png", output.getvalue(), content_type="image/png")


def session(api):
    return api.get("/api/auth/session/").json()


def test_a_new_profile_has_no_name_or_photo(api):
    assert session(api)["profile"] == {
        "display_name": "",
        "handle": "",
        "avatar_url": None,
    }


def test_the_display_name_is_saved(api):
    response = api.patch(
        "/api/auth/profile/", {"display_name": "Carlos Lugones"}, format="json"
    )

    assert response.status_code == 200
    assert response.json()["display_name"] == "Carlos Lugones"
    assert session(api)["profile"]["display_name"] == "Carlos Lugones"


def test_the_display_name_can_be_cleared(api):
    api.patch("/api/auth/profile/", {"display_name": "Carlos"}, format="json")

    response = api.patch("/api/auth/profile/", {"display_name": ""}, format="json")

    assert response.json()["display_name"] == ""


def test_the_handle_is_saved(api):
    response = api.patch("/api/auth/profile/", {"handle": "carlos-l"}, format="json")

    assert response.status_code == 200
    assert response.json()["handle"] == "carlos-l"
    # The display name is left as it was.
    assert response.json()["display_name"] == ""


@pytest.mark.parametrize("handle", ["Carlos", "c", "carlos l", "-carlos", "x" * 41])
def test_the_handle_is_an_address(api, handle):
    response = api.patch("/api/auth/profile/", {"handle": handle}, format="json")

    assert response.status_code == 400
    assert "handle" in response.json()


def test_someone_else_s_handle_is_refused(api, other_user):
    Profile.objects.create(user=other_user, handle="carlos")

    response = api.patch("/api/auth/profile/", {"handle": "carlos"}, format="json")

    assert response.status_code == 400
    assert response.json() == {"handle": ["Someone else already has this name."]}


def test_the_display_name_is_short(api):
    response = api.patch(
        "/api/auth/profile/", {"display_name": "x" * 81}, format="json"
    )

    assert response.status_code == 400


def test_a_photo_becomes_a_square_avatar(api):
    response = api.post("/api/auth/profile/avatar/", {"file": png()})

    assert response.status_code == 200
    url = response.json()["avatar_url"]
    assert url.startswith("/api/auth/profile/avatar/?v=")
    served = api.get(url)
    assert served["Content-Type"] == "image/webp"
    with Image.open(io.BytesIO(b"".join(served.streaming_content))) as image:
        assert image.size == (256, 256)


def test_a_new_photo_replaces_the_old_file(api, user, tmp_path):
    api.post("/api/auth/profile/avatar/", {"file": png()})
    api.post("/api/auth/profile/avatar/", {"file": png()})

    assert len(list((tmp_path / "avatars" / str(user.id)).iterdir())) == 1


def test_the_photo_can_be_removed(api, user, tmp_path):
    api.post("/api/auth/profile/avatar/", {"file": png()})

    response = api.delete("/api/auth/profile/avatar/")

    assert response.json()["avatar_url"] is None
    assert list((tmp_path / "avatars" / str(user.id)).iterdir()) == []
    assert api.get("/api/auth/profile/avatar/").status_code == 404


def test_what_isn_t_an_image_is_refused(api):
    file = SimpleUploadedFile("me.png", b"not an image", content_type="image/png")

    response = api.post("/api/auth/profile/avatar/", {"file": file})

    assert response.status_code == 400


def test_the_photo_is_not_open_without_signing_in(api, client):
    api.post("/api/auth/profile/avatar/", {"file": png()})

    assert client.get("/api/auth/profile/avatar/").status_code == 403
