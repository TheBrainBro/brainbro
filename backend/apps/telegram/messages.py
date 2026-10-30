"""
What a message sent or forwarded to the bot becomes: the same items a paste
or a drop would make, in the inbox.

- Text: one URL alone becomes a link, anything else a note. Links hidden
  under text (`text_link`) are kept as Markdown links.
- Photos become images and files become image or file items (detected by
  content, like any upload), with the caption as their text. Photos sent
  together (an album on Telegram) become an album.
- Anything else (stickers, locations, polls…) can't be kept.
"""

import mimetypes

from django.core.files.base import ContentFile
from django.db import transaction

from apps.items.capture import infer_item_fields
from apps.items.models import Item
from apps.items.uploads import UploadTooLarge, inspect_upload
from apps.items.views import create_upload_item, enqueue_preview

from . import bot

# Message fields that carry a file, and the name one gets without its own.
FILE_FIELDS = {
    "document": "file",
    "video": "video",
    "audio": "audio",
    "animation": "animation",
    "voice": "voice message",
    "video_note": "video message",
}


class Unsupported(ValueError):
    pass


def save_message(owner, message):
    """The item made from `message`, created in the inbox."""
    caption = _markdown(message.get("caption", ""), message.get("caption_entities"))
    if photos := message.get("photo"):
        largest = max(
            photos, key=lambda size: size.get("width", 0) * size.get("height", 0)
        )
        data = bot.download(largest["file_id"], largest.get("file_size"))
        return _upload(owner, message, data, "photo.jpg", caption)
    for field, fallback in FILE_FIELDS.items():
        if file := message.get(field):
            data = bot.download(file["file_id"], file.get("file_size"))
            return _upload(owner, message, data, _filename(file, fallback), caption)
    text = _markdown(message.get("text", ""), message.get("entities"))
    if text.strip():
        with transaction.atomic():
            item = Item.objects.create(owner=owner, **infer_item_fields(text))
            if item.kind == Item.Kind.LINK:
                item.preview_status = Item.PreviewStatus.PENDING
                item.save(update_fields=["preview_status"])
                enqueue_preview(item)
        return item
    raise Unsupported


def _upload(owner, message, data, filename, caption):
    file = ContentFile(data, name=filename)
    try:
        upload = inspect_upload(file)
    except UploadTooLarge:
        raise bot.FileTooLarge from None
    with transaction.atomic():
        item = create_upload_item(owner, file, upload)
        fields = []
        if caption:
            item.body = caption
            fields.append("body")
        if group := message.get("media_group_id"):
            # Grouped into an album once the rest have arrived (see tasks).
            item.metadata["telegram_media_group"] = group
            item.metadata["telegram_message_id"] = message.get("message_id", 0)
            fields.append("metadata")
        if fields:
            item.save(update_fields=fields)
        if item.preview_status == Item.PreviewStatus.PENDING:
            enqueue_preview(item)
    return item


def _filename(file, fallback):
    if name := file.get("file_name"):
        return name
    extension = mimetypes.guess_extension(file.get("mime_type", "")) or ""
    return f"{fallback}{extension}"


def _markdown(text, entities):
    """`text` with its `text_link` entities as Markdown links."""
    links = sorted(
        (
            entity
            for entity in entities or []
            if entity.get("type") == "text_link" and entity.get("url")
        ),
        key=lambda entity: entity["offset"],
    )
    if not links:
        return text
    # Entity offsets count UTF-16 code units.
    units = text.encode("utf-16-le")
    parts, position = [], 0
    for link in links:
        start = link["offset"] * 2
        end = start + link["length"] * 2
        if start < position or end > len(units):
            continue
        parts.append(units[position:start].decode("utf-16-le"))
        label = units[start:end].decode("utf-16-le")
        label = label.replace("[", r"\[").replace("]", r"\]")
        url = link["url"]
        if any(c in url for c in " ()"):
            url = f"<{url}>"
        parts.append(f"[{label}]({url})")
        position = end
    parts.append(units[position:].decode("utf-16-le"))
    return "".join(parts)
