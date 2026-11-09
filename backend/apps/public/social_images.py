"""
A blog's social image: what a shared link shows when the page has no image of
its own. The browser crops and shrinks it before uploading, so re-encoding it
here stays cheap; the limits below keep it that way.

JPEG, not WebP like the blog's other images: it is read by every app that
previews links, and not all of them read WebP.
"""

import io
import logging

from PIL import Image, ImageOps

from apps.items.collection_images import FORMATS, MAX_BYTES, MAX_PIXELS

logger = logging.getLogger(__name__)

SIZE = (1200, 630)


def make_social_image(file):
    """JPEG bytes of `file` cropped to SIZE, or None if unusable."""
    if file.size > MAX_BYTES:
        return None
    try:
        with Image.open(file, formats=FORMATS) as image:
            width, height = image.size
            if width * height > MAX_PIXELS:
                return None
            image = ImageOps.exif_transpose(image).convert("RGBA")
            # JPEG has no transparency: what was see-through turns white.
            flat = Image.new("RGB", image.size, "white")
            flat.paste(image, mask=image.getchannel("A"))
            cropped = ImageOps.fit(flat, SIZE)
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        logger.info("Unusable social image: %s", exc)
        return None
    output = io.BytesIO()
    cropped.save(output, format="JPEG", quality=85)
    return output.getvalue()
