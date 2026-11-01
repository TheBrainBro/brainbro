import logging

from celery import shared_task
from celery.signals import worker_ready
from django.conf import settings
from django.db import transaction

from apps.items.albums import make_album, set_album_images
from apps.items.models import Item
from apps.items.origin import Source, acting

from . import bot
from .updates import handle_update

logger = logging.getLogger(__name__)

# Photos sent together arrive one by one; the album is made once they're in.
ALBUM_DELAY = 5


@shared_task
def process_update(update):
    with acting(Source.TELEGRAM):
        item = handle_update(update)
    if item is not None and (group := item.metadata.get("telegram_media_group")):
        group_media.apply_async((item.owner_id, group), countdown=ALBUM_DELAY)


@shared_task
def group_media(owner_id, group_id):
    """
    Puts the images of a Telegram album into one Brain album, in the order
    they were sent, with their captions as its text. Runs once per image, so
    a late one joins the album the others made.
    """
    with transaction.atomic(), acting(Source.TELEGRAM):
        images = sorted(
            Item.objects.select_for_update().filter(
                owner_id=owner_id,
                kind=Item.Kind.IMAGE,
                metadata__telegram_media_group=group_id,
            ),
            key=lambda image: image.metadata.get("telegram_message_id", 0),
        )
        albums = {image.album for image in images if image.album_id}
        if albums:
            album = albums.pop()
            set_album_images(album, images)
        elif len(images) >= 2:
            album = make_album(images[0].owner, images)
        else:
            return
        captions = [image.body for image in images if image.body]
        if captions:
            album.body = "\n\n".join(filter(None, [album.body, *captions]))
            album.save(update_fields=["body", "updated_at"])
            Item.objects.filter(id__in=[image.id for image in images]).update(body="")


@shared_task
def register_webhook():
    """Points the bot at this app, with the secret every update must carry."""
    bot.call(
        "setWebhook",
        url=settings.TELEGRAM_WEBHOOK_URL,
        secret_token=bot.webhook_secret(),
        allowed_updates=["message"],
        # One at a time, so a chat's messages are saved in order.
        max_connections=1,
    )
    logger.info("Telegram webhook set to %s", settings.TELEGRAM_WEBHOOK_URL)


@worker_ready.connect
def register_on_start(**kwargs):
    if bot.configured() and settings.TELEGRAM_WEBHOOK_URL:
        register_webhook.delay()
