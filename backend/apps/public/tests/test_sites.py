import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import Profile
from apps.items.models import Collection, Item
from apps.public.handles import public_handle
from apps.public.models import Redirect, Site
from apps.public.publishing import publish, unpublish
from apps.public.sites import normalize_hostname
from apps.public.tasks import verify_site

INDEX = (
    "<html><head><title>BrainBro</title>"
    '<link rel="manifest" href="/manifest.webmanifest">'
    "</head><body></body></html>"
)
BLOG = "blog.example.com"
NEW = "new.example.com"


@pytest.fixture(autouse=True)
def build(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    (tmp_path / "index.html").write_text(INDEX)
    settings.FRONTEND_DIST_DIR = tmp_path


@pytest.fixture
def dns(monkeypatch):
    """The TXT records public DNS answers with, by name."""
    records = {}
    monkeypatch.setattr(
        "apps.public.tasks.txt_values", lambda name: set(records.get(name, []))
    )
    return records


@pytest.fixture
def anyone():
    return APIClient()


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


def note(user, title="", body="text", collection=None):
    item = Item.objects.create(owner=user, kind=Item.Kind.NOTE, title=title, body=body)
    if collection:
        item.collections.add(collection)
    return item


def on_blog(client, path, host=BLOG):
    return client.get(path, HTTP_HOST=host)


# Domains


@pytest.mark.parametrize(
    ("value", "hostname"),
    [
        ("Blog.Example.com.", "blog.example.com"),
        ("  example.com ", "example.com"),
        ("café.example.com", "xn--caf-dma.example.com"),
        ("localhost", ""),
        ("blog.example.com:8000", ""),
        ("https://blog.example.com", ""),
        ("blog..example.com", ""),
        ("1.2.3.4", ""),
    ],
)
def test_what_a_domain_can_be(value, hostname):
    assert normalize_hostname(value) == hostname


# Managing blogs, as the owner


def test_a_blog_starts_unverified_with_its_dns_records(api, writing, settings):
    settings.SITE_CNAME_TARGET = "brainbro.example.com"

    response = api.post(
        "/api/sites/",
        {"hostname": "Blog.Example.com", "collection": str(writing.id)},
        format="json",
    )

    assert response.status_code == 201
    data = response.json()
    assert data["hostname"] == BLOG
    assert data["status"] == "unverified"
    assert data["url"] == f"https://{BLOG}/"
    site = Site.objects.get()
    assert data["records"] == [
        {"type": "CNAME", "name": BLOG, "value": "brainbro.example.com"},
        {
            "type": "TXT",
            "name": f"_brainbro.{BLOG}",
            "value": f"brainbro-site-verification={site.token}",
        },
    ]


def test_root_domains_get_an_a_record_when_the_server_s_ip_is_set(api, settings, user):
    settings.SITE_IPV4 = "203.0.113.7"
    Site.objects.create(owner=user, hostname="example.com")

    records = api.get("/api/sites/").json()[0]["records"]

    assert {"type": "A", "name": "example.com", "value": "203.0.113.7"} in records


def test_the_cname_points_at_the_app_s_host_by_default(api, user):
    Site.objects.create(owner=user, hostname=BLOG)

    records = api.get("/api/sites/").json()[0]["records"]

    assert records[0] == {"type": "CNAME", "name": BLOG, "value": "testserver"}


@pytest.mark.parametrize("hostname", ["not a domain", "testserver.", "localhost"])
def test_what_isn_t_a_blog_domain_is_refused(api, hostname):
    response = api.post("/api/sites/", {"hostname": hostname}, format="json")

    assert response.status_code == 400
    assert "hostname" in response.json()


def test_a_domain_another_blog_verified_is_refused(api, other_user):
    Site.objects.create(owner=other_user, hostname=BLOG, status=Site.Status.VERIFIED)

    response = api.post("/api/sites/", {"hostname": BLOG}, format="json")

    assert response.status_code == 400
    assert response.json() == {"hostname": ["Another blog already uses this domain."]}


def test_a_domain_someone_added_but_never_verified_stays_free(api, other_user):
    Site.objects.create(owner=other_user, hostname=BLOG)

    response = api.post("/api/sites/", {"hostname": BLOG}, format="json")

    assert response.status_code == 201


def test_a_blog_is_on_one_of_the_owner_s_collections(api, other_user):
    theirs = Collection.objects.create(owner=other_user, name="Theirs")

    response = api.post(
        "/api/sites/",
        {"hostname": BLOG, "collection": str(theirs.id)},
        format="json",
    )

    assert response.status_code == 400
    assert "collection" in response.json()


def test_a_blog_never_verified_just_changes_domain(api, user):
    site = Site.objects.create(owner=user, hostname=BLOG)

    response = api.patch(f"/api/sites/{site.id}/", {"hostname": NEW}, format="json")

    assert response.status_code == 200
    data = response.json()
    assert data["hostname"] == NEW
    assert data["pending_hostname"] == ""
    assert data["status"] == "unverified"
    assert data["records"][0]["name"] == NEW


def test_a_verified_blog_keeps_serving_while_its_new_domain_is_pending(api, blog):
    response = api.patch(f"/api/sites/{blog.id}/", {"hostname": NEW}, format="json")

    assert response.status_code == 200
    data = response.json()
    assert data["hostname"] == BLOG
    assert data["status"] == "verified"
    assert data["pending_hostname"] == NEW
    assert data["pending_status"] == "unverified"
    assert data["url"] == f"https://{BLOG}/"
    assert on_blog(APIClient(), "/").status_code == 200
    assert on_blog(APIClient(), "/", host=NEW).status_code == 400


def test_a_pending_domain_shows_its_own_records(api, blog):
    data = api.patch(f"/api/sites/{blog.id}/", {"hostname": NEW}, format="json").json()

    assert {record["name"] for record in data["records"]} == {NEW, f"_brainbro.{NEW}"}


def test_sending_the_current_domain_calls_a_move_off(api, blog):
    blog.pending_hostname = NEW
    blog.pending_status = Site.Status.FAILED
    blog.save()

    data = api.patch(f"/api/sites/{blog.id}/", {"hostname": BLOG}, format="json").json()

    assert data["hostname"] == BLOG
    assert data["status"] == "verified"
    assert data["pending_hostname"] == ""
    assert data["pending_status"] == "unverified"


def test_a_pending_domain_another_blog_verified_is_refused(api, blog, other_user):
    Site.objects.create(owner=other_user, hostname=NEW, status=Site.Status.VERIFIED)

    response = api.patch(f"/api/sites/{blog.id}/", {"hostname": NEW}, format="json")

    assert response.status_code == 400
    assert response.json() == {"hostname": ["Another blog already uses this domain."]}


def test_a_domain_another_of_your_blogs_is_moving_to_is_refused(api, blog):
    blog.pending_hostname = NEW
    blog.save()

    response = api.post("/api/sites/", {"hostname": NEW}, format="json")

    assert response.status_code == 400
    assert response.json() == {"hostname": ["You already have a blog on this domain."]}


def test_changing_other_settings_leaves_a_move_alone(api, blog):
    blog.pending_hostname = NEW
    blog.save()

    data = api.patch(
        f"/api/sites/{blog.id}/", {"title": "Renamed"}, format="json"
    ).json()

    assert data["title"] == "Renamed"
    assert data["pending_hostname"] == NEW


def test_other_users_blogs_are_out_of_reach(api, other_user):
    site = Site.objects.create(owner=other_user, hostname=BLOG)

    assert api.get("/api/sites/").json() == []
    assert api.get(f"/api/sites/{site.id}/").status_code == 404
    assert api.post(f"/api/sites/{site.id}/verify/").status_code == 404
    assert api.delete(f"/api/sites/{site.id}/").status_code == 404


# Verifying


def test_the_txt_record_verifies_the_domain(api, user, dns):
    site = Site.objects.create(owner=user, hostname=BLOG)
    dns[f"_brainbro.{BLOG}"] = ["other", f"brainbro-site-verification={site.token}"]

    response = api.post(f"/api/sites/{site.id}/verify/")

    assert response.status_code == 202
    site.refresh_from_db()
    assert site.status == Site.Status.VERIFIED
    assert site.verified_at is not None
    assert site.checked_at is not None


def test_without_the_txt_record_verification_fails(api, user, dns):
    site = Site.objects.create(owner=user, hostname=BLOG)
    dns[f"_brainbro.{BLOG}"] = ["brainbro-site-verification=someone-elses"]

    api.post(f"/api/sites/{site.id}/verify/")

    site.refresh_from_db()
    assert site.status == Site.Status.FAILED
    assert site.verified_at is None


def test_a_blog_whose_record_is_gone_stops_serving(api, blog, dns):
    api.post(f"/api/sites/{blog.id}/verify/")

    blog.refresh_from_db()
    assert blog.status == Site.Status.FAILED
    assert on_blog(APIClient(), "/").status_code == 400


def test_a_domain_verified_by_another_blog_fails(api, user, other_user, dns):
    Site.objects.create(owner=other_user, hostname=BLOG, status=Site.Status.VERIFIED)
    site = Site.objects.create(owner=user, hostname=BLOG)
    dns[f"_brainbro.{BLOG}"] = [f"brainbro-site-verification={site.token}"]

    api.post(f"/api/sites/{site.id}/verify/")

    site.refresh_from_db()
    assert site.status == Site.Status.FAILED


# Moving to a new domain


@pytest.fixture
def moving(blog):
    blog.pending_hostname = NEW
    blog.save()
    return blog


def test_a_found_record_moves_the_blog_to_its_new_domain(api, moving, dns, user):
    Redirect.objects.create(owner=user, site=moving, path="/old", target="/new")
    dns[f"_brainbro.{NEW}"] = [f"brainbro-site-verification={moving.token}"]

    response = api.post(f"/api/sites/{moving.id}/verify/")

    assert response.status_code == 202
    moving.refresh_from_db()
    assert moving.hostname == NEW
    assert moving.status == Site.Status.VERIFIED
    assert moving.verified_at is not None
    assert moving.pending_hostname == ""
    assert moving.pending_status == Site.Status.UNVERIFIED
    assert moving.title == "Carlos writes"
    assert moving.redirects.count() == 1
    assert on_blog(APIClient(), "/", host=NEW).status_code == 200
    assert on_blog(APIClient(), "/").status_code == 400


def test_the_record_of_the_old_domain_doesn_t_move_a_blog(api, moving, dns):
    dns[f"_brainbro.{BLOG}"] = [f"brainbro-site-verification={moving.token}"]

    api.post(f"/api/sites/{moving.id}/verify/")

    moving.refresh_from_db()
    assert moving.hostname == BLOG
    assert moving.pending_hostname == NEW
    assert moving.pending_status == Site.Status.FAILED


def test_a_failed_move_leaves_the_blog_serving(api, moving, dns):
    api.post(f"/api/sites/{moving.id}/verify/")

    moving.refresh_from_db()
    assert moving.status == Site.Status.VERIFIED
    assert moving.pending_status == Site.Status.FAILED
    assert on_blog(APIClient(), "/").status_code == 200


def test_a_blog_keeps_serving_while_its_new_domain_is_checked(api, moving, monkeypatch):
    monkeypatch.setattr("apps.public.views.verify_site.delay", lambda site_id: None)

    data = api.post(f"/api/sites/{moving.id}/verify/").json()

    assert data["status"] == "verified"
    assert data["pending_status"] == "checking"
    assert on_blog(APIClient(), "/").status_code == 200


def test_a_domain_another_blog_verifies_first_fails_the_move(
    api, moving, dns, other_user
):
    Site.objects.create(owner=other_user, hostname=NEW, status=Site.Status.VERIFIED)
    dns[f"_brainbro.{NEW}"] = [f"brainbro-site-verification={moving.token}"]

    api.post(f"/api/sites/{moving.id}/verify/")

    moving.refresh_from_db()
    assert moving.hostname == BLOG
    assert moving.pending_status == Site.Status.FAILED
    assert on_blog(APIClient(), "/").status_code == 200


def test_a_move_called_off_during_the_lookup_stays_off(moving, monkeypatch):
    def lookup(name):
        Site.objects.filter(id=moving.id).update(pending_hostname="")
        return {f"brainbro-site-verification={moving.token}"}

    monkeypatch.setattr("apps.public.tasks.txt_values", lookup)

    verify_site(str(moving.id))

    moving.refresh_from_db()
    assert moving.hostname == BLOG
    assert moving.status == Site.Status.VERIFIED


# Certificates on demand


def test_the_proxy_gets_certificates_only_for_verified_blogs(anyone, blog, other_user):
    Site.objects.create(owner=other_user, hostname="unverified.example.com")

    url = "/api/public/sites/check/"
    assert anyone.get(url, {"domain": BLOG}).status_code == 200
    assert anyone.get(url, {"domain": "Blog.Example.com"}).status_code == 200
    assert anyone.get(url, {"domain": "unverified.example.com"}).status_code == 404
    assert anyone.get(url, {"domain": "nobody.example.com"}).status_code == 404
    assert anyone.get(url).status_code == 404


# Hosts


def test_unknown_hosts_are_turned_away(client, blog):
    assert on_blog(client, "/", host="nobody.example.com").status_code == 400


def test_an_unverified_blog_serves_nothing(client, user):
    Site.objects.create(owner=user, hostname=BLOG)

    assert on_blog(client, "/").status_code == 400


@pytest.mark.parametrize(
    "path",
    [
        "/notes/x/",
        "/admin/login/",
        "/api/items/",
        "/api/auth/session/",
        "/api/sites/",
        "/api/health/",
        "/sw.js",
        "/@carlos/hello",
    ],
)
def test_a_blog_s_domain_never_reaches_the_app(client, blog, path):
    assert on_blog(client, path).status_code == 404


def test_a_slug_like_an_app_route_is_the_blog_s(client, blog):
    response = on_blog(client, "/admin/")

    assert response.status_code == 200
    assert "brainbro-site" in response.content.decode()


def test_a_blog_never_sees_the_app_s_session(client, user, blog):
    client.force_login(user)

    response = on_blog(client, "/api/public/notes/")

    assert response.status_code == 200
    assert "sessionid" not in response.cookies


# Reading a blog


def test_a_blog_s_index_is_the_app_as_a_blog(client, blog):
    html = on_blog(client, "/").content.decode()

    assert f'<meta name="brainbro-site" content="{BLOG}" />' in html
    assert "<title>Carlos writes</title>" in html
    assert f'<link rel="canonical" href="https://{BLOG}/" />' in html
    assert 'href="/rss"' in html
    # A blog is no app to install.
    assert "manifest" not in html


def test_a_blog_lists_only_its_published_notes(anyone, user, blog, writing):
    publish(note(user, title="On the blog", collection=writing))
    publish(note(user, title="Elsewhere"))
    note(user, title="Draft", collection=writing)
    unpublish(publish(note(user, title="Taken down", collection=writing)))

    results = on_blog(anyone, "/api/public/notes/").json()["results"]

    assert [(entry["title"], entry["url"]) for entry in results] == [
        ("On the blog", "/on-the-blog")
    ]


def test_an_unlisted_note_opens_on_the_blog_but_lists_nowhere(
    anyone, client, user, blog, writing
):
    publish(note(user, title="Hidden", collection=writing), listed=False)
    publish(note(user, title="Shown", collection=writing))

    results = on_blog(anyone, "/api/public/notes/").json()["results"]
    feed = on_blog(client, "/rss").content.decode()
    sitemap = on_blog(client, "/sitemap.xml").content.decode()

    assert [entry["title"] for entry in results] == ["Shown"]
    assert "Hidden" not in feed
    assert "/hidden" not in sitemap
    assert "Shown" in feed
    handle = public_handle(user.id)
    assert on_blog(anyone, f"/api/public/notes/{handle}/hidden/").status_code == 200


def test_search_engines_are_told_to_skip_only_unlisted_notes(
    client, user, blog, writing
):
    publish(note(user, title="Hidden", collection=writing), listed=False)
    publish(note(user, title="Shown", collection=writing))
    noindex = '<meta name="robots" content="noindex" />'

    assert noindex in on_blog(client, "/hidden").content.decode()
    assert noindex not in on_blog(client, "/shown").content.decode()


def test_a_category_of_only_unlisted_notes_does_not_show(anyone, user, blog, writing):
    travel = Collection.objects.create(owner=user, name="Travel", parent=writing)
    publish(note(user, title="Hidden", collection=travel), listed=False)

    assert on_blog(anyone, "/api/public/site/").json()["categories"] == []


def test_a_blog_says_what_it_is(anyone, user, blog):
    Profile.objects.update_or_create(user=user, defaults={"display_name": "Carlos"})

    data = on_blog(anyone, "/api/public/site/").json()

    assert data == {
        "hostname": BLOG,
        "title": "Carlos writes",
        "description": "",
        "author": "Carlos",
        "show_author": True,
        "handle": "carlos",
        "avatar_url": None,
        "links": [],
        "powered_by": True,
        "categories": [],
    }
    assert anyone.get("/api/public/site/").status_code == 404


def test_a_blog_is_named_after_its_collection_by_default(anyone, blog):
    blog.title = ""
    blog.save()

    assert on_blog(anyone, "/api/public/site/").json()["title"] == "Writing"


def test_a_note_on_a_blog_is_at_its_slug(client, anyone, user, blog, writing):
    item = publish(note(user, title="Hello", collection=writing))
    handle = user.profile.handle

    html = on_blog(client, "/hello").content.decode()
    data = on_blog(anyone, f"/api/public/notes/{handle}/hello/").json()

    assert "<title>Hello</title>" in html
    assert f'<link rel="canonical" href="https://{BLOG}/hello" />' in html
    assert data["slug"] == item.public_slug


def test_notes_off_the_blog_are_not_on_it(anyone, user, blog):
    publish(note(user, title="Elsewhere"))

    response = on_blog(anyone, f"/api/public/notes/{user.profile.handle}/elsewhere/")

    assert response.status_code == 404


def test_links_on_a_blog_lead_to_its_notes(anyone, user, blog, writing):
    publish(note(user, title="Packing", collection=writing))
    publish(note(user, title="Elsewhere"))
    body = "[[Packing]] [[Elsewhere]]"
    publish(note(user, title="Plan", body=body, collection=writing))

    data = on_blog(anyone, f"/api/public/notes/{user.profile.handle}/plan/").json()

    assert {"url": "/packing", "title": "Packing"} in data["notes"]
    assert "Elsewhere" not in [entry["title"] for entry in data["notes"]]


def test_a_note_on_a_blog_lives_there(client, api, user, blog, writing):
    item = publish(note(user, title="Hello", collection=writing))

    response = client.get(f"/@{user.profile.handle}/hello")
    data = api.get(f"/api/items/{item.id}/").json()

    assert response.status_code == 301
    assert response["Location"] == f"https://{BLOG}/hello"
    assert data["public_url"] == f"https://{BLOG}/hello"
    assert client.get("/p/hello")["Location"] == f"https://{BLOG}/hello"


def test_links_elsewhere_lead_to_the_blog(anyone, user, blog, writing):
    publish(note(user, title="Packing", collection=writing))
    publish(note(user, title="Plan", body="[[Packing]]"))

    data = anyone.get(f"/api/public/notes/{user.profile.handle}/plan/").json()

    assert {"url": f"https://{BLOG}/packing", "title": "Packing"} in data["notes"]


def test_the_page_settings_show_the_blog_s_address(api, user, blog, writing):
    item = publish(note(user, title="Hello", collection=writing))

    assert (
        api.get(f"/api/items/{item.id}/page/").json()["address"] == f"https://{BLOG}/"
    )


# Feeds


def test_a_blog_has_a_feed_of_its_notes(client, user, blog, writing):
    publish(note(user, title="Hello <you>", body="First words.", collection=writing))
    publish(note(user, title="Elsewhere"))

    response = on_blog(client, "/rss")
    feed = response.content.decode()

    # Shown by browsers, not downloaded.
    assert response["Content-Type"].startswith("application/xml")
    assert "<title>Carlos writes</title>" in feed
    assert "<title>Hello &lt;you&gt;</title>" in feed
    assert f"<link>https://{BLOG}/hello-you</link>" in feed
    assert "First words." in feed
    assert "Elsewhere" not in feed


def test_a_blog_has_a_sitemap_and_robots(client, user, blog, writing):
    publish(note(user, title="Hello", collection=writing))

    sitemap = on_blog(client, "/sitemap.xml").content.decode()
    robots = on_blog(client, "/robots.txt").content.decode()

    assert f"<loc>https://{BLOG}/</loc>" in sitemap
    assert f"<loc>https://{BLOG}/hello</loc>" in sitemap
    assert f"Sitemap: https://{BLOG}/sitemap.xml" in robots


def test_locally_a_blog_is_where_django_serves_it(api, user, blog, writing, settings):
    settings.SITE_SCHEME = "http"
    settings.SITE_PORT = "8000"
    item = publish(note(user, title="Hello", collection=writing))

    assert api.get(f"/api/items/{item.id}/").json()["public_url"] == (
        f"http://{BLOG}:8000/hello"
    )


# Categories, links and "Powered by"


@pytest.fixture
def travel(user, writing):
    return Collection.objects.create(owner=user, name="Travel & Trips", parent=writing)


def test_notes_in_collections_inside_the_blog_s_are_on_it(anyone, user, blog, travel):
    deeper = Collection.objects.create(owner=user, name="Japan", parent=travel)
    publish(note(user, title="Tokyo", collection=deeper))

    results = on_blog(anyone, "/api/public/notes/").json()["results"]

    assert [(entry["title"], entry["url"]) for entry in results] == [
        ("Tokyo", "/tokyo")
    ]


def test_the_collections_inside_a_blog_s_are_its_categories(
    anyone, user, blog, writing, travel
):
    Collection.objects.create(owner=user, name="Empty", parent=writing)
    publish(note(user, title="Tokyo", collection=travel))
    publish(note(user, title="Hello", collection=writing))

    data = on_blog(anyone, "/api/public/site/").json()
    in_travel = on_blog(anyone, "/api/public/notes/?category=travel-trips").json()

    # Only those with something published.
    assert data["categories"] == [{"slug": "travel-trips", "name": "Travel & Trips"}]
    assert [entry["title"] for entry in in_travel["results"]] == ["Tokyo"]
    assert on_blog(anyone, "/api/public/notes/?category=nope").status_code == 404


def test_a_category_page_says_what_it_is(client, user, blog, travel):
    publish(note(user, title="Tokyo", collection=travel))

    html = on_blog(client, "/c/travel-trips").content.decode()

    assert "<title>Travel &amp; Trips · Carlos writes</title>" in html
    assert f'<link rel="canonical" href="https://{BLOG}/c/travel-trips" />' in html


def test_a_blog_shows_its_links(api, anyone, blog):
    links = [{"name": "Website", "url": "https://carlos.dev"}]

    response = api.patch(f"/api/sites/{blog.id}/", {"links": links}, format="json")

    assert response.status_code == 200
    assert on_blog(anyone, "/api/public/site/").json()["links"] == links


@pytest.mark.parametrize(
    "link",
    [
        {"name": "Bad", "url": "javascript:alert(1)"},
        {"name": "Bad", "url": "ftp://carlos.dev"},
        {"name": "", "url": "https://carlos.dev"},
        {"name": "x" * 61, "url": "https://carlos.dev"},
    ],
)
def test_a_link_must_be_a_web_address_with_a_name(api, blog, link):
    response = api.patch(f"/api/sites/{blog.id}/", {"links": [link]}, format="json")

    assert response.status_code == 400


def test_a_blog_has_ten_links_at_most(api, blog):
    links = [{"name": f"L{n}", "url": f"https://x.dev/{n}"} for n in range(11)]

    response = api.patch(f"/api/sites/{blog.id}/", {"links": links}, format="json")

    assert response.status_code == 400


# Who signs a blog


def png():
    output = io.BytesIO()
    Image.new("RGB", (400, 300), "red").save(output, format="PNG")
    return SimpleUploadedFile("logo.png", output.getvalue(), content_type="image/png")


def test_a_blog_signs_as_its_owner_until_it_has_its_own_author(api, anyone, user, blog):
    Profile.objects.update_or_create(user=user, defaults={"display_name": "Carlos"})
    assert on_blog(anyone, "/api/public/site/").json()["author"] == "Carlos"

    api.patch(f"/api/sites/{blog.id}/", {"author": "BrainBro"}, format="json")
    assert on_blog(anyone, "/api/public/site/").json()["author"] == "BrainBro"

    api.patch(f"/api/sites/{blog.id}/", {"author": ""}, format="json")
    assert on_blog(anyone, "/api/public/site/").json()["author"] == "Carlos"


def test_a_blogs_author_signs_its_notes_feed_and_shared_links(
    api, anyone, user, blog, writing
):
    Profile.objects.update_or_create(user=user, defaults={"display_name": "Carlos"})
    publish(note(user, "Update", collection=writing))
    api.patch(f"/api/sites/{blog.id}/", {"author": "BrainBro"}, format="json")
    slug = Item.objects.get().public_slug
    handle = public_handle(user.id)

    data = on_blog(anyone, f"/api/public/notes/{handle}/{slug}/").json()
    assert data["author"] == "BrainBro"
    assert "BrainBro" in on_blog(anyone, "/rss").content.decode()
    page = on_blog(anyone, f"/{slug}").content.decode()
    assert '<meta name="author" content="BrainBro" />' in page


def test_the_author_line_can_be_hidden(api, anyone, blog):
    api.patch(f"/api/sites/{blog.id}/", {"show_author": False}, format="json")

    assert on_blog(anyone, "/api/public/site/").json()["show_author"] is False


def test_a_blogs_photo_replaces_its_owners_on_that_blog_only(
    api, anyone, user, blog, writing
):
    profile, _ = Profile.objects.get_or_create(user=user)
    profile.avatar.save("me.webp", SimpleUploadedFile("me.webp", b"img"))
    publish(note(user, "Update", collection=writing))
    slug = Item.objects.get().public_slug
    handle = public_handle(user.id)
    before = on_blog(anyone, "/api/public/site/").json()["avatar_url"]
    assert before.startswith(f"/api/public/authors/{handle}/avatar/")

    response = api.post(f"/api/sites/{blog.id}/avatar/", {"file": png()})

    assert response.status_code == 200
    assert response.json()["avatar_url"].startswith(f"/api/sites/{blog.id}/avatar/")
    url = on_blog(anyone, "/api/public/site/").json()["avatar_url"]
    assert url.startswith("/api/public/site/avatar/")
    assert on_blog(anyone, url).status_code == 200
    data = on_blog(anyone, f"/api/public/notes/{handle}/{slug}/").json()
    assert data["avatar_url"] == url
    assert anyone.get(f"/api/public/authors/{handle}/").json()["avatar_url"] == before


def test_removing_a_blogs_photo_goes_back_to_its_owners(api, anyone, blog, settings):
    api.post(f"/api/sites/{blog.id}/avatar/", {"file": png()})

    response = api.delete(f"/api/sites/{blog.id}/avatar/")

    assert response.json()["avatar_url"] is None
    assert on_blog(anyone, "/api/public/site/").json()["avatar_url"] is None
    assert on_blog(anyone, "/api/public/site/avatar/").status_code == 404
    assert list((settings.MEDIA_ROOT / "avatars" / "sites").rglob("*.webp")) == []


def test_deleting_a_blog_deletes_its_photo(api, blog, settings):
    api.post(f"/api/sites/{blog.id}/avatar/", {"file": png()})

    api.delete(f"/api/sites/{blog.id}/")

    assert list((settings.MEDIA_ROOT / "avatars" / "sites").rglob("*.webp")) == []


def test_a_blogs_photo_must_be_an_image(api, blog):
    file = SimpleUploadedFile("a.txt", b"nope", content_type="text/plain")

    response = api.post(f"/api/sites/{blog.id}/avatar/", {"file": file})

    assert response.status_code == 400


def test_only_its_owner_changes_a_blogs_photo(api, other_user):
    site = Site.objects.create(owner=other_user, hostname=BLOG)

    response = api.post(f"/api/sites/{site.id}/avatar/", {"file": png()})

    assert response.status_code == 404


def test_powered_by_shows_until_it_is_turned_off(api, anyone, blog):
    assert on_blog(anyone, "/api/public/site/").json()["powered_by"] is True

    api.patch(f"/api/sites/{blog.id}/", {"powered_by": False}, format="json")

    assert on_blog(anyone, "/api/public/site/").json()["powered_by"] is False


# Redirects


def test_an_old_address_redirects_for_good(anyone, user, blog):
    Redirect.objects.create(owner=user, site=blog, path="/mi-viaje", target="/viena")
    Redirect.objects.create(
        owner=user, site=blog, path="/Café", target="https://example.com/cafe"
    )

    response = on_blog(anyone, "/mi-viaje/?from=telegram")
    assert response.status_code == 301
    assert response["Location"] == "/viena"
    response = on_blog(anyone, "/Caf%C3%A9")
    assert response.status_code == 301
    assert response["Location"] == "https://example.com/cafe"


def test_redirects_are_their_blog_s_only(anyone, user, other_user, blog):
    Redirect.objects.create(owner=user, site=blog, path="/mi-viaje", target="/viena")

    # Not on the app's own domain.
    assert anyone.get("/mi-viaje").status_code != 301
    # Nor on an unverified blog.
    blog.status = Site.Status.UNVERIFIED
    blog.save()
    assert on_blog(anyone, "/mi-viaje").status_code == 400


def test_a_blog_s_own_pages_never_redirect(anyone, user, blog):
    # Made by hand: save_redirects refuses them.
    Redirect.objects.create(owner=user, site=blog, path="/rss", target="/elsewhere")

    assert on_blog(anyone, "/rss").status_code == 200
