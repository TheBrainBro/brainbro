from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from config.env import get_env_variable


class Command(BaseCommand):
    help = (
        "Create the admin user from ADMIN_USERNAME / ADMIN_PASSWORD if it does "
        "not exist yet. Safe to run on every deploy; never changes an existing "
        "user's password."
    )

    def handle(self, *args, **options):
        username = get_env_variable("ADMIN_USERNAME", raise_error=False)
        password = get_env_variable("ADMIN_PASSWORD", raise_error=False)
        if not username or not password:
            self.stdout.write("ADMIN_USERNAME/ADMIN_PASSWORD not set, skipping.")
            return

        User = get_user_model()
        if User.objects.filter(username=username).exists():
            self.stdout.write(f"Admin user '{username}' already exists.")
            return

        User.objects.create_superuser(
            username=username,
            email=get_env_variable("ADMIN_EMAIL", ""),
            password=password,
        )
        self.stdout.write(self.style.SUCCESS(f"Admin user '{username}' created."))
