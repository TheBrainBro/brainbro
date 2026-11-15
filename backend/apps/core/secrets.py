"""
Secrets the server keeps in its database, such as the email provider's API
key: encrypted with a key derived from `SECRET_KEY`, so a database dump or a
backup doesn't carry them readable. Changing `SECRET_KEY` makes them
unreadable: they have to be entered again.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def fernet():
    digest = hashlib.sha256(
        b"brainbro.secrets:" + settings.SECRET_KEY.encode()
    ).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value):
    return fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(value):
    """The secret, or "" if there is none or it can't be read any more."""
    if not value:
        return ""
    try:
        return fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return ""
