"""
Password reset links: Django's token, for one user, in the app's address.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode


def reset_path(user):
    """Where the link in the email opens, in the app."""
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    return f"/reset-password/{uid}/{default_token_generator.make_token(user)}"


def user_for(uid, token):
    """The user a link is for, if it still works."""
    User = get_user_model()
    try:
        pk = force_str(urlsafe_base64_decode(uid))
        user = User.objects.get(pk=pk, is_active=True)
    except (ValueError, OverflowError, User.DoesNotExist):
        return None
    return user if default_token_generator.check_token(user, token) else None
