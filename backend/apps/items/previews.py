"""
Link previews: page metadata (OpenGraph, Twitter cards, plain HTML) plus
oEmbed, and a local copy of the preview image.
"""

import io
import json
import logging
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import quote, urljoin, urlsplit

from PIL import Image, ImageOps

from .safe_http import FetchError, TransientFetchError, fetch

logger = logging.getLogger(__name__)

MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_OEMBED_BYTES = 256 * 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
PREVIEW_IMAGE_SIZE = (1200, 1200)
# Common web raster formats only: a smaller decoder surface for untrusted bytes.
IMAGE_FORMATS = ("JPEG", "PNG", "GIF", "WEBP", "AVIF")

# Sites that support oEmbed but don't advertise it (or block scrapers).
OEMBED_PROVIDERS = [
    (
        re.compile(
            r"^https?://((www|m|music)\.)?(youtube\.com/(watch|shorts/|live/)|youtu\.be/)"
        ),
        "https://www.youtube.com/oembed",
    ),
    (
        re.compile(r"^https?://((www|mobile)\.)?(twitter|x)\.com/[^/]+/status/"),
        "https://publish.twitter.com/oembed",
    ),
    (
        re.compile(r"^https?://(www\.)?vimeo\.com/\d+"),
        "https://vimeo.com/api/oembed.json",
    ),
]

HTML_TYPES = ("text/html", "application/xhtml+xml")
_META_CHARSET = re.compile(rb"""<meta[^>]+charset=["']?([\w-]+)""", re.IGNORECASE)


@dataclass
class Preview:
    metadata: dict = field(default_factory=dict)
    image_url: str | None = None


class _HeadParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.links = []
        self._title = []
        self._in_title = False

    @property
    def title(self):
        return " ".join("".join(self._title).split())

    def handle_starttag(self, tag, attrs):
        attrs = {key: value or "" for key, value in attrs}
        if tag == "meta":
            key = (attrs.get("property") or attrs.get("name") or "").lower()
            content = attrs.get("content", "").strip()
            if key and content:
                self.meta.setdefault(key, content)
        elif tag == "link" and attrs.get("href"):
            self.links.append(
                (attrs.get("rel", "").lower().split(), attrs.get("type", ""), attrs)
            )
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self._title.append(data)


class _TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def _html_to_text(html):
    parser = _TextParser()
    parser.feed(html)
    return " ".join("".join(parser.parts).split())


def _first(mapping, *keys):
    return next((mapping[key] for key in keys if mapping.get(key)), "")


def decode_html(fetched):
    charset = fetched.charset
    if not charset and (match := _META_CHARSET.search(fetched.content[:4096])):
        charset = match.group(1).decode()
    try:
        return fetched.content.decode(charset or "utf-8", errors="replace")
    except LookupError:
        return fetched.content.decode("utf-8", errors="replace")


def parse_html(html, base_url):
    """Extract preview fields and the oEmbed endpoint from a page."""
    parser = _HeadParser()
    parser.feed(html)
    meta = parser.meta

    favicon = oembed_url = ""
    for rel, link_type, attrs in parser.links:
        if not favicon and ("icon" in rel or "apple-touch-icon" in rel):
            favicon = attrs["href"]
        if "alternate" in rel and link_type == "application/json+oembed":
            oembed_url = oembed_url or attrs["href"]

    image = _first(
        meta,
        "og:image:secure_url",
        "og:image",
        "og:image:url",
        "twitter:image",
        "twitter:image:src",
    )
    return {
        "title": _first(meta, "og:title", "twitter:title")[:500] or parser.title[:500],
        "description": _first(
            meta, "og:description", "twitter:description", "description"
        )[:1000],
        "site_name": _first(meta, "og:site_name", "application-name")[:200],
        "author": _first(meta, "author", "article:author")[:200],
        "image_url": urljoin(base_url, image) if image else "",
        "favicon_url": urljoin(base_url, favicon or "/favicon.ico"),
        "oembed_url": urljoin(base_url, oembed_url) if oembed_url else "",
    }


def known_oembed_endpoint(url):
    for pattern, endpoint in OEMBED_PROVIDERS:
        if pattern.match(url):
            return f"{endpoint}?format=json&url={quote(url, safe='')}"
    return None


def fetch_oembed(endpoint):
    fetched = fetch(endpoint, max_bytes=MAX_OEMBED_BYTES, accept="application/json")
    data = json.loads(fetched.content)
    if not isinstance(data, dict):
        raise FetchError("oEmbed response is not an object")
    keep = (
        "type",
        "title",
        "author_name",
        "author_url",
        "provider_name",
        "thumbnail_url",
        "html",
        "width",
        "height",
    )
    return {key: data[key] for key in keep if data.get(key) not in (None, "")}


def build_preview(url):
    """
    Fetch `url` and gather its preview. Raises FetchError/TransientFetchError
    when nothing usable could be fetched.
    """
    known_endpoint = known_oembed_endpoint(url)
    page = {}
    page_error = None
    final_url = url
    image_url = None

    try:
        fetched = fetch(
            url,
            max_bytes=MAX_HTML_BYTES,
            accept="text/html,application/xhtml+xml,*/*;q=0.8",
        )
        final_url = fetched.url
        if fetched.content_type in HTML_TYPES:
            page = parse_html(decode_html(fetched), fetched.url)
        elif fetched.content_type.startswith("image/"):
            image_url = fetched.url
    except (FetchError, TransientFetchError) as exc:
        # Known oEmbed providers can still describe a page we can't scrape.
        if not known_endpoint:
            raise
        page_error = exc

    oembed = {}
    endpoint = known_endpoint or page.get("oembed_url")
    if endpoint:
        try:
            oembed = fetch_oembed(endpoint)
        except (FetchError, TransientFetchError, ValueError) as exc:
            if page_error:
                raise page_error from exc
            logger.info("oEmbed failed: %s", type(exc).__name__)

    host = urlsplit(final_url).hostname or ""
    metadata = {
        "title": page.get("title") or oembed.get("title", ""),
        "description": page.get("description")
        or _html_to_text(oembed.get("html", ""))[:1000],
        "site_name": page.get("site_name")
        or oembed.get("provider_name")
        or host.removeprefix("www."),
        "author": oembed.get("author_name") or page.get("author", ""),
        "favicon_url": page.get("favicon_url", ""),
        "final_url": final_url,
    }
    if oembed:
        metadata["oembed"] = oembed
    image_url = image_url or page.get("image_url") or oembed.get("thumbnail_url")
    if image_url:
        metadata["image_url"] = image_url
    return Preview(
        metadata={k: v for k, v in metadata.items() if v}, image_url=image_url
    )


def to_preview_image(data):
    """
    Re-encode image bytes as a bounded WebP. Returns None if `data` is not a
    raster image we can read. Re-encoding means we never serve the original
    bytes (SVG scripts, polyglots) from our own origin.
    """
    return reencode_image(io.BytesIO(data), IMAGE_FORMATS, MAX_IMAGE_PIXELS)


def reencode_image(source, formats, max_pixels):
    """
    Re-encode an image file object as a WebP bounded to PREVIEW_IMAGE_SIZE,
    upright according to its EXIF orientation. None if it is not a raster
    image in one of `formats` or has more than `max_pixels`.
    """
    try:
        with Image.open(source, formats=formats) as image:
            width, height = image.size
            if width * height > max_pixels:
                return None
            image.draft("RGB", PREVIEW_IMAGE_SIZE)
            return encode_preview(ImageOps.exif_transpose(image))
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        logger.info("Unusable preview image: %s", exc)
        return None


def encode_preview(image):
    """A decoded image as WebP bytes bounded to PREVIEW_IMAGE_SIZE."""
    image.thumbnail(PREVIEW_IMAGE_SIZE)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    output = io.BytesIO()
    image.save(output, format="WEBP", quality=82)
    return output.getvalue()


def download_preview_image(image_url):
    """
    Fetch and re-encode a preview image. None if there is no usable image;
    TransientFetchError propagates so the caller can retry.
    """
    try:
        fetched = fetch(image_url, max_bytes=MAX_IMAGE_BYTES, accept="image/*")
    except FetchError as exc:
        logger.info("Preview image fetch failed: %s", type(exc).__name__)
        return None
    return to_preview_image(fetched.content)
