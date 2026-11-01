import pytest
from django.core.files.base import ContentFile

from apps.accounts.models import Profile
from apps.items.models import Item, NoteImage
from apps.public.pages import excerpt
from apps.public.publishing import publish, unpublish

INDEX = "<html><head><title>Brain</title></head><body></body></html>"


@pytest.fixture(autouse=True)
def build(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    (tmp_path / "index.html").write_text(INDEX)
    settings.FRONTEND_DIST_DIR = tmp_path


def note(user, title="", body="text"):
    return Item.objects.create(owner=user, kind=Item.Kind.NOTE, title=title, body=body)


def test_the_excerpt_is_the_text_as_plain_words():
    body = "# Trip\n\nTen days in **Japan**, see [[Packing|the list]].\n\n![map](x.png)"
    assert excerpt(body) == "Ten days in Japan, see the list."


def test_long_excerpts_end_on_a_word():
    text = excerpt("word " * 100)
    assert len(text) <= 161
    assert text.endswith("word…")


def test_a_public_page_tells_what_it_is(client, user):
    item = publish(note(user, title="Trip <plan>", body="Ten days in Japan."))
    image = NoteImage.objects.create(
        owner=user, note=item, source=NoteImage.Source.REMOTE, src="https://x/a.png"
    )
    image.image.save("image.webp", ContentFile(b"img"))
    item.body += "\n\n![a](https://x/a.png)"
    item.save()

    html = client.get("/p/trip-plan").content.decode()

    assert "<title>Trip &lt;plan&gt;</title>" in html
    assert '<meta property="og:title" content="Trip &lt;plan&gt;" />' in html
    assert '<meta property="og:description" content="Ten days in Japan." />' in html
    assert '<meta property="og:url" content="http://testserver/p/trip-plan" />' in html
    assert (
        '<meta property="og:image" '
        f'content="http://testserver/api/public/notes/trip-plan/images/{image.id}/'
    ) in html
    assert '<meta property="twitter:card" content="summary_large_image" />' in html


def test_a_page_names_its_author(client, user):
    Profile.objects.create(user=user, display_name="Carlos <L>")
    publish(note(user, title="Plan"))

    html = client.get("/p/plan").content.decode()

    assert '<meta name="author" content="Carlos &lt;L&gt;" />' in html


def test_pages_not_published_say_nothing(client, user):
    unpublish(publish(note(user, title="Plan")))

    html = client.get("/p/plan").content.decode()

    assert html == INDEX
