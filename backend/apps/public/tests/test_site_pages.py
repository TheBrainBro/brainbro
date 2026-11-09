import json
import re

import pytest
from django.utils import timezone

from apps.accounts.models import Profile
from apps.items.models import Collection, Item
from apps.public.models import Redirect, Site
from apps.public.publishing import publish

BLOG = "blog.example.com"
INDEX = (
    "<html><head>"
    '<link rel="stylesheet" crossorigin href="/static/assets/index-abc.css">'
    "</head><body></body></html>"
)


@pytest.fixture(autouse=True)
def build(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    (tmp_path / "index.html").write_text(INDEX)
    settings.FRONTEND_DIST_DIR = tmp_path


@pytest.fixture
def writing(user):
    return Collection.objects.create(owner=user, name="Writing")


@pytest.fixture
def blog(user, writing):
    return Site.objects.create(
        owner=user,
        hostname=BLOG,
        collection=writing,
        title="Carlos writes",
        status=Site.Status.VERIFIED,
    )


def note(user, title, body="Some text.", collection=None):
    item = Item.objects.create(owner=user, kind=Item.Kind.NOTE, title=title, body=body)
    if collection:
        collection.items.add(item)
    return item


def get(client, path, **headers):
    return client.get(path, HTTP_HOST=BLOG, **headers)


def test_a_post_is_in_the_html(client, user, blog, writing):
    publish(note(user, "Hello", "A **bold** claim.", writing))

    html = get(client, "/hello").content.decode()

    assert "<strong>bold</strong> claim" in html
    assert "<h1" in html and ">Hello</h1>" in html
    assert "<script src" not in html
    assert 'id="root"' not in html


def test_the_index_lists_posts_as_plain_links(client, user, blog, writing):
    publish(note(user, "Hello", "Start of the text.", writing))

    html = get(client, "/").content.decode()

    assert 'href="/hello"' in html
    assert "Start of the text." in html


def test_an_unknown_address_is_a_real_404(client, blog):
    response = get(client, "/nope")

    assert response.status_code == 404
    assert "This page doesn&#x27;t exist" in response.content.decode()
    assert 'content="noindex"' in response.content.decode()


def test_an_address_with_no_route_is_the_blog_s_404_too(client, blog):
    response = get(client, "/Some/Old/Page.html")

    assert response.status_code == 404
    assert "This page doesn" in response.content.decode()


def test_an_unknown_category_is_a_404(client, blog):
    assert get(client, "/c/nope").status_code == 404


def test_a_private_note_is_a_404(client, user, blog, writing):
    note(user, "Secret", collection=writing)

    assert get(client, "/secret").status_code == 404


def test_a_note_taken_down_is_a_404(client, user, blog, writing):
    item = publish(note(user, "Hello", collection=writing))
    Item.objects.filter(id=item.id).update(published_at=None)

    assert get(client, "/hello").status_code == 404


def test_an_unlisted_note_opens_but_is_not_listed(client, user, blog, writing):
    publish(note(user, "Hidden", collection=writing), listed=False)

    assert get(client, "/hidden").status_code == 200
    assert 'href="/hidden"' not in get(client, "/").content.decode()


def test_categories_are_tabs(client, user, blog, writing):
    travel = Collection.objects.create(owner=user, name="Travel", parent=writing)
    publish(note(user, "Tokyo", collection=travel))
    publish(note(user, "Other", collection=writing))

    html = get(client, "/c/travel").content.decode()

    assert re.search(r'href="/c/travel"\s+aria-current="page"', html)
    assert 'href="/tokyo"' in html
    assert 'href="/other"' not in html


def test_a_post_offers_the_blog_s_other_posts(client, user, blog, writing):
    publish(note(user, "One", collection=writing))
    publish(note(user, "Two", collection=writing))

    html = get(client, "/one").content.decode()

    assert 'href="/two"' in html
    assert 'href="/one"' not in html


def test_a_post_links_its_published_notes_only(client, user, blog, writing):
    publish(note(user, "Packing", collection=writing))
    note(user, "Secret", collection=writing)
    publish(note(user, "Plan", "[[Packing]] and [[Secret]]", writing))

    html = get(client, "/plan").content.decode()

    assert '<a class="wikilink" href="/packing">Packing</a>' in html
    assert 'href="/secret"' not in html


def test_a_post_describes_itself_to_search_engines(client, user, blog, writing):
    Profile.objects.update_or_create(user=user, defaults={"display_name": "Carlos"})
    item = publish(note(user, "Hello", "A claim </script> here.", writing))
    item.edited_at = timezone.now()
    item.save(update_fields=["edited_at"])

    html = get(client, "/hello").content.decode()

    block = re.search(r'ld\+json">(.*?)</script>', html, re.DOTALL)[1]
    data = json.loads(block)
    assert data["@type"] == "BlogPosting"
    assert data["headline"] == "Hello"
    assert data["url"] == f"https://{BLOG}/hello"
    assert data["author"] == {"@type": "Person", "name": "Carlos"}
    assert data["dateModified"]
    assert "</script> here" not in block
    assert 'property="article:published_time"' in html


def test_the_page_follows_the_visitor_s_language(client, user, blog, writing):
    publish(note(user, "Hello", collection=writing))

    english = get(client, "/hello")
    spanish = get(client, "/hello", HTTP_ACCEPT_LANGUAGE="es-ES,es;q=0.9,en;q=0.8")

    assert "All posts" in english.content.decode()
    assert '<html lang="en">' in english.content.decode()
    assert "Todas las publicaciones" in spanish.content.decode()
    assert '<html lang="es">' in spanish.content.decode()
    assert re.search(r"\d+ de [a-z]+ de \d{4}", spanish.content.decode())
    assert "Accept-Language" in spanish["Vary"]


def test_a_language_it_doesn_t_speak_falls_back_to_english(client, blog):
    html = get(client, "/", HTTP_ACCEPT_LANGUAGE="fr-FR").content.decode()

    assert '<html lang="en">' in html


def test_the_stylesheet_is_the_app_s(client, blog):
    html = get(client, "/").content.decode()

    assert '<link rel="stylesheet" href="/static/assets/index-abc.css" />' in html


def test_the_powered_by_line_can_be_turned_off(client, blog):
    assert "brainbro.app" in get(client, "/").content.decode()

    Site.objects.filter(id=blog.id).update(powered_by=False)

    assert "brainbro.app" not in get(client, "/").content.decode()


def test_what_a_blog_writes_about_itself_is_escaped(client, blog):
    Site.objects.filter(id=blog.id).update(description="<img src=x onerror=y>")

    assert "<img src=x" not in get(client, "/").content.decode()


def test_old_addresses_still_redirect(client, user, blog):
    Redirect.objects.create(owner=user, site=blog, path="/old", target="/new")

    response = get(client, "/old")

    assert response.status_code == 301
    assert response["Location"] == "/new"


def test_a_head_request_answers(client, blog):
    assert client.head("/", HTTP_HOST=BLOG).status_code == 200
