import pytest
from rest_framework.test import APIRequestFactory


@pytest.fixture
def context(user):
    request = APIRequestFactory().get("/")
    request.user = user
    return {"request": request}
