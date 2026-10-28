"""
Files captured as items: detect what they really are, never trusting the
name or the type the browser sends.

Images in a known raster format become `image` items; everything else,
SVG included (it can carry scripts), becomes a `file` item.
"""

import mimetypes
from dataclasses import dataclass

import magic
from django.conf import settings
from PIL import Image, UnidentifiedImageError
from pillow_heif import register_heif_opener

from .models import Item

register_heif_opener()

# libmagic needs the first few KB to tell formats apart reliably.
SNIFF_BYTES = 8192
MAX_IMAGE_PIXELS = 50_000_000
MAX_FILENAME_LENGTH = 255

# Detected MIME type -> (Pillow format, stored extension).
IMAGE_TYPES = {
    "image/jpeg": ("JPEG", "jpg"),
    "image/png": ("PNG", "png"),
    "image/gif": ("GIF", "gif"),
    "image/webp": ("WEBP", "webp"),
    "image/avif": ("AVIF", "avif"),
    "image/heic": ("HEIF", "heic"),
    "image/heif": ("HEIF", "heif"),
}
IMAGE_FORMATS = tuple({fmt for fmt, _ in IMAGE_TYPES.values()})
# Types a browser can render that are safe to show inline from our origin.
INLINE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"}


class UploadTooLarge(ValueError):
    pass


@dataclass
class Upload:
    kind: str
    mime: str
    extension: str
    metadata: dict


def detect_mime(file):
    file.seek(0)
    head = file.read(SNIFF_BYTES)
    file.seek(0)
    return magic.from_buffer(head, mime=True) or "application/octet-stream"


def _image_size(file, pillow_format):
    """(width, height) if `file` really decodes as `pillow_format`, else None."""
    try:
        with Image.open(file, formats=[pillow_format]) as image:
            size = image.size
            if size[0] * size[1] > MAX_IMAGE_PIXELS:
                return None
            image.verify()
            return size
    except (
        OSError,
        ValueError,
        SyntaxError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
    ):
        return None
    finally:
        file.seek(0)


def _clean_filename(name):
    name = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(c for c in name if c.isprintable()).strip()
    return name[:MAX_FILENAME_LENGTH] or "file"


def inspect_upload(file):
    """Classify an uploaded file. Raises UploadTooLarge over the size limit."""
    if file.size > settings.UPLOAD_MAX_SIZE:
        raise UploadTooLarge
    mime = detect_mime(file)
    metadata = {
        "filename": _clean_filename(file.name),
        "mime": mime,
        "size": file.size,
    }
    if mime in IMAGE_TYPES:
        pillow_format, extension = IMAGE_TYPES[mime]
        if size := _image_size(file, pillow_format):
            metadata["width"], metadata["height"] = size
            return Upload(Item.Kind.IMAGE, mime, extension, metadata)
    extension = (mimetypes.guess_extension(mime) or ".bin").lstrip(".")
    return Upload(Item.Kind.FILE, mime, extension, metadata)
