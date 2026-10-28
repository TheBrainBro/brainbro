"""
Files captured as items: detect what they really are, never trusting the
name or the type the browser sends.

Images in a known raster format become `image` items; everything else,
SVG included (it can carry scripts), becomes a `file` item.
"""

import logging
import mimetypes
import threading
from dataclasses import dataclass

import magic
import pypdfium2 as pdfium
from django.conf import settings
from PIL import Image, UnidentifiedImageError
from pillow_heif import register_heif_opener

from .models import Item
from .previews import PREVIEW_IMAGE_SIZE, encode_preview, reencode_image

logger = logging.getLogger(__name__)

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
PDF_TYPE = "application/pdf"
# Never render a page larger than this, whatever size it claims to be.
MAX_PDF_SCALE = 3

# PDFium is not thread-safe, and the dev worker runs tasks in threads.
_pdfium_lock = threading.Lock()


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


def has_thumbnail(item):
    """Whether a background task makes this upload's card image."""
    return item.kind == Item.Kind.IMAGE or (
        item.kind == Item.Kind.FILE and item.metadata.get("mime") == PDF_TYPE
    )


def make_thumbnail(item):
    """WebP bytes for an image or PDF item's card, or None if unreadable."""
    with item.file.open("rb") as source:
        if item.kind == Item.Kind.IMAGE:
            return reencode_image(source, IMAGE_FORMATS, MAX_IMAGE_PIXELS)
        return pdf_first_page(source.read())


def pdf_first_page(data):
    """
    Render the first page of a PDF, sized for a card. None if the PDF is
    broken, encrypted or has no pages.
    """
    try:
        with _pdfium_lock:
            pdf = pdfium.PdfDocument(data)
            try:
                if len(pdf) == 0:
                    return None
                page = pdf[0]
                width, height = page.get_size()
                if width <= 0 or height <= 0:
                    return None
                scale = min(max(PREVIEW_IMAGE_SIZE) / max(width, height), MAX_PDF_SCALE)
                # Encode before closing: the PIL image shares PDFium's buffer.
                return encode_preview(page.render(scale=scale).to_pil())
            finally:
                pdf.close()
    except (pdfium.PdfiumError, OSError, ValueError) as exc:
        logger.info("Unusable PDF: %s", exc)
        return None
