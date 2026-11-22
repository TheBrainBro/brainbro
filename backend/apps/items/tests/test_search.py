import pytest
from rest_framework.test import APIClient

from apps.accounts.models import ApiToken
from apps.items.models import FileIndex, Item, ItemPassage


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


def test_sample_items_are_excluded_from_app_search(api, user):
    Item.objects.create(owner=user, kind="note", body="Starter secret", is_sample=True)
    real = Item.objects.create(
        owner=user, kind="note", body="Starter notes", is_sample=False
    )
    assert ids(search(api, "starter")) == [str(real.id)]
    inbox = api.get("/api/items/", {"status": "inbox"}).json()["results"]
    assert {item["id"] for item in inbox} == {
        str(real.id),
        str(Item.objects.get(is_sample=True).id),
    }


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


def indexed_file(owner, kind="file", **fields):
    item = Item.objects.create(owner=owner, kind=kind, file="uploads/example", **fields)
    FileIndex.objects.create(item=item, source=item.file.name)
    return item


def test_pdf_matches_are_bounded_and_open_the_matching_pages(api, user):
    pdf = indexed_file(user, status="archived")
    for page in range(1, 9):
        text = "café, then a menu" if page == 1 else "café menu"
        ItemPassage.objects.create(
            item=pdf, page=page, position=page, text="context " * 100 + text
        )
    Item.objects.create(owner=user, kind="note", title="Menu")

    results = search(api, "cafe menu")
    assert ids(results)[0] == str(pdf.id)
    assert [hit["page"] for hit in results[0]["matches"]] == [2, 3, 4, 5, 6]
    for hit in results[0]["matches"]:
        assert "café menu" in hit["text"]
        assert len(hit["text"]) <= 222
        assert hit["start_seconds"] is None
    assert results[1]["matches"] == []
    listed = api.get("/api/items/", {"q": "cafe menu", "status": "archived"}).json()
    assert [row["id"] for row in listed["results"]] == [str(pdf.id)]


def test_photo_text_matches_point_to_each_image_in_the_album(api, user):
    album = Item.objects.create(owner=user, kind="album", title="Whiteboards")
    images = [
        indexed_file(user, kind="image", album=album, album_position=i)
        for i in range(2)
    ]
    for i, image in enumerate(images):
        ItemPassage.objects.create(item=image, position=0, text=f"Workshop number {i}")

    results = search(api, "workshop")
    assert ids(results) == [str(album.id)]
    assert [(hit["album_image"], hit["text"]) for hit in results[0]["matches"]] == [
        (str(image.id), f"Workshop number {i}") for i, image in enumerate(images)
    ]


def test_recording_match_uses_first_and_last_word_times(api, user):
    audio = indexed_file(user, kind="audio")
    ItemPassage.objects.create(
        item=audio,
        position=0,
        text="Café agenda today. The café opens. The café opens at noon.",
        start_seconds=5,
        end_seconds=13,
        words=[
            {"text": "Café", "start": 5, "end": 5.5},
            {"text": "agenda", "start": 5.5, "end": 6.0},
            {"text": "today.", "start": 6, "end": 6.5},
            {"text": "The", "start": 7.2, "end": 7.5},
            {"text": "café", "start": 7.5, "end": 8.3},
            {"text": "opens.", "start": 8.4, "end": 9.0},
            {"text": "The", "start": 9.1, "end": 9.3},
            {"text": "café", "start": 9.3, "end": 9.7},
            {"text": "opens", "start": 9.7, "end": 10},
            {"text": "at", "start": 10.4, "end": 10.8},
            {"text": "noon.", "start": 11.0, "end": 13},
        ],
    )
    ItemPassage.objects.create(
        item=audio,
        position=1,
        text="A new café opens",
        start_seconds=37,
        end_seconds=40,
    )
    hits = search(api, "CAFE opens")[0]["matches"]
    assert [(h["start_seconds"], h["end_seconds"]) for h in hits] == [
        (7.5, 9.0),
        (9.3, 10.0),
        (37.0, 40.0),
    ]


def test_transcript_offsets_use_the_index_accent_dictionary(api, user):
    audio = indexed_file(user, kind="audio")
    ItemPassage.objects.create(
        item=audio,
        position=0,
        text="Today our œuvre opens",
        start_seconds=2,
        end_seconds=10,
        words=[
            {"text": "Today", "start": 2, "end": 3},
            {"text": "our", "start": 3, "end": 4},
            {"text": "œuvre", "start": 8, "end": 9},
            {"text": "opens", "start": 9, "end": 10},
        ],
    )
    match = search(api, "oeuvre")[0]["matches"][0]
    assert (match["start_seconds"], match["end_seconds"]) == (8, 9)


def test_passage_search_obeys_ownership_and_skips_sample_and_stale_text(
    user, other_user
):
    mine = indexed_file(user)
    stale = indexed_file(user)
    for item in [
        mine,
        stale,
        indexed_file(other_user),
        indexed_file(user, is_sample=True),
    ]:
        ItemPassage.objects.create(item=item, position=0, page=1, text="confidential")
    Item.objects.filter(pk=stale.pk).update(file="uploads/replacement")

    _, key = ApiToken.issue(user, "Script")
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {key}")
    assert ids(search(client, "confidential")) == [str(mine.pk)]
    assert (
        APIClient().get("/api/items/search/", {"q": "confidential"}).status_code == 403
    )


def test_wrapped_literal_phrase_ranks_before_five_unordered_pages(api, user):
    pdf = indexed_file(user)
    first, second = r"C++_%\src", "(X|Y).*"
    for page in range(1, 7):
        separator = "\n\t\x1c" if page == 6 else " and later "
        ItemPassage.objects.create(
            item=pdf,
            page=page,
            position=page,
            text=f"prefix{first}{separator}{second}suffix",
        )
    hits = search(api, f"{first}  {second}")[0]["matches"]
    assert [hit["page"] for hit in hits] == [6, 1, 2, 3, 4]
    assert hits[0]["text"] == f"prefix{first}\n\t\x1c{second}suffix"


def test_only_current_scoped_passages_suppress_metadata_typos(api, user, other_user):
    typo = Item.objects.create(owner=user, kind="note", title="Kubernets")
    stale = indexed_file(user)
    for hidden in [stale, indexed_file(other_user), indexed_file(user, is_sample=True)]:
        ItemPassage.objects.create(item=hidden, position=0, page=1, text="Kubernetes")
    Item.objects.filter(pk=stale.pk).update(file="uploads/replaced")
    assert ids(search(api, "Kubernetes")) == [str(typo.pk)]

    pdf = indexed_file(user)
    ItemPassage.objects.create(item=pdf, position=0, page=1, text="Kubernetes")
    assert ids(search(api, "Kubernetes")) == [str(pdf.pk)]
    notes = api.get("/api/items/", {"q": "Kubernetes", "kind": "note"}).json()
    assert [item["id"] for item in notes["results"]] == [str(typo.pk)]
