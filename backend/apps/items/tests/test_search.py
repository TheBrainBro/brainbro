import pytest

from apps.items.models import Item


def search(api, query):
    response = api.get("/api/items/search/", {"q": query})
    assert response.status_code == 200
    return response.json()


def ids(results):
    return [result["item"]["id"] for result in results]


@pytest.fixture
def link(user):
    return Item.objects.create(
        owner=user,
        kind="link",
        url="https://example.com/post",
        metadata={
            "title": "Deploying Kubernetes",
            "description": "A guide to clusters",
            "site_name": "Ops Weekly",
        },
    )


def test_finds_titles_bodies_urls_and_preview_metadata(api, user, link):
    note = Item.objects.create(owner=user, kind="note", body="Notes on clusters")
    upload = Item.objects.create(
        owner=user, kind="file", metadata={"filename": "cluster-plan.pdf"}
    )
    Item.objects.create(owner=user, kind="note", body="Groceries")

    assert set(ids(search(api, "cluster"))) == {
        str(link.id),
        str(note.id),
        str(upload.id),
    }
    assert ids(search(api, "ops weekly")) == [str(link.id)]
    assert ids(search(api, "example.com/po")) == [str(link.id)]


def test_tolerates_typos_in_longer_words(api, link):
    assert ids(search(api, "kubernets")) == [str(link.id)]
    assert ids(search(api, "deploing kubernets")) == [str(link.id)]
    # Too short to tell a typo from another word.
    assert search(api, "gide") == []


def test_ignores_accents_and_case(api, user):
    note = Item.objects.create(owner=user, kind="note", body="Un CAFÉ en la Ñ")
    assert ids(search(api, "cafe en la n")) == [str(note.id)]
    assert ids(search(api, "Café")) == [str(note.id)]


def test_items_with_every_word_come_before_partial_matches(api, user):
    alone = Item.objects.create(owner=user, kind="note", title="Paris alone")
    both = Item.objects.create(owner=user, kind="note", body="paris and rome")
    Item.objects.create(owner=user, kind="note", body="madrid")
    # The title match doesn't lift a partial match above a full one.
    assert ids(search(api, "rome paris")) == [str(both.id), str(alone.id)]


def test_partial_matches_rank_by_how_many_words_match(api, user):
    one = Item.objects.create(owner=user, kind="note", body="trip notes")
    two = Item.objects.create(owner=user, kind="note", body="trip to paris")
    query = "notes about the trip to paris in spring"
    assert ids(search(api, query)) == [str(two.id), str(one.id)]


def test_short_words_alone_dont_make_a_partial_match(api, user):
    Item.objects.create(owner=user, kind="note", body="to do in la casa")
    assert search(api, "trip to paris in spring") == []
    # They still match when every word is there.
    note = Item.objects.create(owner=user, kind="note", body="ir a la playa")
    assert ids(search(api, "ir a la")) == [str(note.id)]


def test_short_words_dont_add_to_the_rank(api, user):
    # "to" and "on" are in it, but they're in almost everything.
    noise = Item.objects.create(owner=user, kind="note", body="to do on the lake trip")
    trip = Item.objects.create(owner=user, kind="note", body="paris trip notes")
    query = "notes on the trip to paris"
    assert ids(search(api, query)) == [str(trip.id), str(noise.id)]


def test_items_matching_only_through_typos_come_last(api, user):
    # "kubernets" and "clustr" appear nowhere, so they stand in for similar
    # words, but those guesses alone rank below one word matched as written.
    guess = Item.objects.create(owner=user, kind="note", title="Kubernetes cluster")
    exact = Item.objects.create(owner=user, kind="note", body="meeting notes")
    query = "kubernets clustr meeting"
    assert ids(search(api, query)) == [str(exact.id), str(guess.id)]


def test_typos_count_in_partial_matches(api, user):
    note = Item.objects.create(owner=user, kind="note", body="kubernetes setup")
    assert ids(search(api, "kubernets cluster")) == [str(note.id)]


def test_title_matches_rank_above_body_matches(api, user):
    in_body = Item.objects.create(owner=user, kind="note", body="about python")
    in_title = Item.objects.create(owner=user, kind="note", title="Python")
    assert ids(search(api, "python")) == [str(in_title.id), str(in_body.id)]


def test_typos_only_stand_in_for_words_that_appear_nowhere(api, user):
    paris = Item.objects.create(owner=user, kind="note", body="paris trip")
    Item.objects.create(owner=user, kind="note", body="parts list")
    assert ids(search(api, "paris")) == [str(paris.id)]
    assert ids(search(api, "pariss")) == [str(paris.id)]


def test_exact_words_rank_above_typos(api, user):
    exact = Item.objects.create(owner=user, kind="note", body="pythn notes")
    typo = Item.objects.create(owner=user, kind="note", body="python notes")
    # "pythn" is there as written, so it isn't taken for a typo of "python".
    assert ids(search(api, "pythn")) == [str(exact.id)]
    exact.delete()
    assert ids(search(api, "pythn")) == [str(typo.id)]


def test_ties_go_newest_first(api, user):
    older = Item.objects.create(owner=user, kind="note", body="same words")
    newer = Item.objects.create(owner=user, kind="note", body="same words")
    assert ids(search(api, "same words")) == [str(newer.id), str(older.id)]


def test_includes_archived_items(api, user):
    archived = Item.objects.create(
        owner=user, kind="note", body="old idea", status="archived"
    )
    results = search(api, "idea")
    assert ids(results) == [str(archived.id)]
    assert results[0]["item"]["status"] == "archived"


def test_album_images_show_up_as_their_album(api, user):
    album = Item.objects.create(owner=user, kind="album", title="Trip")
    first, second = (
        Item.objects.create(
            owner=user,
            kind="image",
            album=album,
            album_position=i,
            metadata={"filename": f"beach-{i}.jpg"},
        )
        for i in range(2)
    )

    results = search(api, "beach")
    assert ids(results) == [str(album.id)]
    assert results[0]["album_image"] in {str(first.id), str(second.id)}
    assert len(results[0]["item"]["album_items"]) == 2

    # The album's own title: no image to point at.
    assert search(api, "trip")[0]["album_image"] is None


def test_only_searches_the_users_items(api, other_user):
    Item.objects.create(owner=other_user, kind="note", body="secret plans")
    assert search(api, "secret") == []


def test_empty_query(api):
    assert search(api, "  ") == []


def test_query_characters_are_not_syntax(api, user):
    note = Item.objects.create(owner=user, kind="note", body="100% done_ok (a|b)")
    for query in ["100%", "done_ok", "(a|b)"]:
        assert ids(search(api, query)) == [str(note.id)]
    for query in ["'", "!:*&", "1_0"]:
        assert search(api, query) == []


def test_list_filter_uses_search_and_sorts_by_relevance(api, user):
    in_body = Item.objects.create(owner=user, kind="note", body="kubernetes notes")
    in_title = Item.objects.create(owner=user, kind="note", title="Kubernetes")
    Item.objects.create(owner=user, kind="note", body="other")

    response = api.get("/api/items/", {"q": "kubernets"})
    results = [item["id"] for item in response.json()["results"]]
    assert results == [str(in_title.id), str(in_body.id)]


def test_search_columns_follow_edits(user):
    note = Item.objects.create(owner=user, kind="note", body="first draft")
    note.body = "final version"
    note.save()
    assert Item.objects.filter(search_text__contains="final").get() == note
    assert not Item.objects.filter(search_text__contains="draft").exists()


def test_finds_images_by_their_caption(api, user):
    image = Item.objects.create(
        owner=user, kind="image", metadata={"filename": "IMG_0042.png"}
    )
    response = api.patch(
        f"/api/items/{image.id}/",
        {"body": "Whiteboard from the pricing workshop"},
        format="json",
    )
    assert response.status_code == 200
    assert ids(search(api, "pricing workshop")) == [str(image.id)]
