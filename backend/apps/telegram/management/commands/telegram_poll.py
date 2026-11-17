from django.core.management.base import BaseCommand, CommandError

from apps.telegram import bot
from apps.telegram.tasks import process_update


class Command(BaseCommand):
    help = (
        "Receive the bot's messages by long polling instead of the webhook, for "
        "development, where there is no public URL. Removes the webhook: the "
        "worker sets it again when it starts, or when the bot is saved in Settings."
    )

    def handle(self, *args, **options):
        if not bot.configured():
            raise CommandError(
                "Set up the bot in Settings, Server, Telegram, or set "
                "TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME."
            )
        bot.call("deleteWebhook")
        self.stdout.write("Polling Telegram. Ctrl+C to stop.")
        offset = 0
        while True:
            try:
                updates = bot.call(
                    "getUpdates", offset=offset, timeout=50, allowed_updates=["message"]
                )
            except bot.BotError as exc:
                self.stderr.write(str(exc))
                continue
            for update in updates:
                offset = update["update_id"] + 1
                process_update.delay(update)
