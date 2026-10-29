import pytest
from django.contrib.auth import get_user_model
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
