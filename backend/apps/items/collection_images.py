"""
A collection's image: a small square, like an avatar. The browser crops and
shrinks it before uploading, so re-encoding it here stays cheap; the limits
below keep it that way.
"""

import io
import logging

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

SIZE = 256
MAX_BYTES = 2 * 1024 * 1024
MAX_PIXELS = 4_000_000
FORMATS = ("JPEG", "PNG", "GIF", "WEBP")


def make_collection_image(file):
    """WebP bytes of `file` cropped square at SIZE, or None if unusable."""
    if file.size > MAX_BYTES:
        return None
    try:
        with Image.open(file, formats=FORMATS) as image:
            width, height = image.size
            if width * height > MAX_PIXELS:
                return None
            image = ImageOps.exif_transpose(image)
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            square = ImageOps.fit(image, (SIZE, SIZE))
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        logger.info("Unusable collection image: %s", exc)
        return None
    output = io.BytesIO()
    square.save(output, format="WEBP", quality=85)
    return output.getvalue()
