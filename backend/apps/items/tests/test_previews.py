import io
import json

import pytest
from PIL import Image

from apps.items import previews
from apps.items.previews import (
    build_preview,
    known_oembed_endpoint,
    parse_html,
    to_preview_image,
)
from apps.items.safe_http import Fetched, FetchError

ARTICLE = """
<html><head>
  <meta charset="utf-8">
  <title> Fallback   title </title>
  <meta property="og:title" content="Caf&eacute; guide">
  <meta name="description" content="Plain description">
  <meta property="og:description" content="OG description">
  <meta property="og:image" content="/img/cover.jpg">
  <meta property="og:site_name" content="Example">
  <link rel="shortcut icon" href="/static/fav.png">
  <link rel="alternate" type="application/json+oembed" href="/oembed?u=1">
</head><body></body></html>
"""


def html(url, body, content_type="text/html"):
    return Fetched(url=url, content_type=content_type, charset=None, content=body)


def png_bytes(size=(2000, 1000), mode="RGB"):
    output = io.BytesIO()
    Image.new(mode, size, "red").save(output, format="PNG")
    return output.getvalue()


def test_parse_html_prefers_opengraph():
    data = parse_html(ARTICLE, "https://example.com/post/1")
    assert data == {
        "title": "Café guide",
        "description": "OG description",
        "site_name": "Example",
        "author": "",
        "image_url": "https://example.com/img/cover.jpg",
        "favicon_url": "https://example.com/static/fav.png",
        "oembed_url": "https://example.com/oembed?u=1",
    }


def test_parse_html_falls_back_to_title_and_default_favicon():
    data = parse_html(
        "<title>Just a title</title><meta name='twitter:image' content='i.png'>",
        "https://example.com/a/b",
    )
    assert data["title"] == "Just a title"
    assert data["image_url"] == "https://example.com/a/i.png"
    assert data["favicon_url"] == "https://example.com/favicon.ico"


@pytest.mark.parametrize(
    "url,provider",
    [
        ("https://www.youtube.com/watch?v=abc", "youtube.com/oembed"),
        ("https://youtu.be/abc", "youtube.com/oembed"),
        ("https://x.com/someone/status/123", "publish.twitter.com"),
        ("https://twitter.com/someone/status/123", "publish.twitter.com"),
        ("https://vimeo.com/123456", "vimeo.com/api/oembed.json"),
        ("https://example.com/watch?v=abc", None),
    ],
)
def test_known_oembed_endpoint(url, provider):
    endpoint = known_oembed_endpoint(url)
    if provider is None:
        assert endpoint is None
    else:
        assert provider in endpoint
        assert "url=https%3A%2F%2F" in endpoint


def test_build_preview_from_page_with_discovered_oembed(monkeypatch):
    responses = {
        "https://example.com/post/1": html(
            "https://example.com/post/1", ARTICLE.encode()
        ),
        "https://example.com/oembed?u=1": html(
            "https://example.com/oembed?u=1",
            json.dumps({"type": "rich", "author_name": "Ana"}).encode(),
            "application/json",
        ),
    }
    monkeypatch.setattr(previews, "fetch", lambda url, **kw: responses[url])

    preview = build_preview("https://example.com/post/1")
    assert preview.image_url == "https://example.com/img/cover.jpg"
    assert preview.metadata["title"] == "Café guide"
    assert preview.metadata["author"] == "Ana"
    assert preview.metadata["oembed"] == {"type": "rich", "author_name": "Ana"}


def test_build_preview_uses_oembed_when_page_cannot_be_scraped(monkeypatch):
    tweet = {
        "author_name": "Someone",
        "provider_name": "Twitter",
        "html": "<blockquote><p>Hello <a href='#'>world</a></p></blockquote>",
    }

    def fake_fetch(url, **kwargs):
        if "publish.twitter.com" in url:
            return html(url, json.dumps(tweet).encode(), "application/json")
        raise FetchError("HTTP 403")

    monkeypatch.setattr(previews, "fetch", fake_fetch)
    preview = build_preview("https://x.com/someone/status/1")
    assert preview.metadata["description"] == "Hello world"
    assert preview.metadata["site_name"] == "Twitter"
    assert preview.metadata["author"] == "Someone"


def test_build_preview_of_an_image_url(monkeypatch):
    monkeypatch.setattr(
        previews, "fetch", lambda url, **kw: html(url, b"\x89PNG", "image/png")
    )
    preview = build_preview("https://cdn.example.com/cat.png")
    assert preview.image_url == "https://cdn.example.com/cat.png"
    assert preview.metadata["site_name"] == "cdn.example.com"


def test_build_preview_raises_when_nothing_fetched(monkeypatch):
    def fail(url, **kwargs):
        raise FetchError("HTTP 404")

    monkeypatch.setattr(previews, "fetch", fail)
    with pytest.raises(FetchError):
        build_preview("https://example.com/gone")


@pytest.mark.parametrize("mode", ["RGB", "RGBA", "P", "L"])
def test_to_preview_image_reencodes_and_bounds_size(mode):
    data = to_preview_image(png_bytes(mode=mode))
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "WEBP"
        assert image.size == (1200, 600)


@pytest.mark.parametrize(
    "data",
    [b"not an image", b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', b""],
)
def test_to_preview_image_rejects_non_raster_data(data):
    assert to_preview_image(data) is None


def test_to_preview_image_rejects_huge_dimensions(monkeypatch):
    monkeypatch.setattr(previews, "MAX_IMAGE_PIXELS", 100)
    assert to_preview_image(png_bytes(size=(20, 20))) is None
