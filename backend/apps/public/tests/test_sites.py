import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Profile
from apps.items.models import Collection, Item
from apps.public.models import Site
from apps.public.publishing import publish, unpublish
from apps.public.sites import normalize_hostname

INDEX = (
    "<html><head><title>BrainBro</title>"
    '<link rel="manifest" href="/manifest.webmanifest">'
    "</head><body></body></html>"
)
BLOG = "blog.example.com"


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


def test_a_new_domain_has_to_be_verified_again(api, blog):
    response = api.patch(
        f"/api/sites/{blog.id}/", {"hostname": "new.example.com"}, format="json"
    )

    assert response.status_code == 200
    assert response.json()["status"] == "unverified"
    assert response.json()["verified_at"] is None


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
    assert 'href="/rss.xml"' in html
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


def test_a_blog_says_what_it_is(anyone, user, blog):
    Profile.objects.update_or_create(user=user, defaults={"display_name": "Carlos"})

    data = on_blog(anyone, "/api/public/site/").json()

    assert data == {
        "hostname": BLOG,
        "title": "Carlos writes",
        "description": "",
        "author": "Carlos",
        "handle": "carlos",
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

    response = on_blog(client, "/rss.xml")
    feed = response.content.decode()

    assert response["Content-Type"].startswith("application/rss+xml")
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
