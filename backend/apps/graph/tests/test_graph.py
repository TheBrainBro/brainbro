from apps.boards.layout import empty_layout
from apps.boards.models import Board
from apps.items.models import Collection, Item


def graph(api):
    response = api.get("/api/graph/")
    assert response.status_code == 200
    data = response.json()
    nodes = {node["id"]: node for node in data["nodes"]}
    edges = {(e["source"], e["target"], e["type"]): e for e in data["edges"]}
    return nodes, edges


def board_node(id, item):
    return {
        "id": id,
        "type": "item",
        "item": str(item.id),
        "x": 0,
        "y": 0,
        "w": None,
        "h": None,
        "parent": None,
    }


def test_items_and_collections_with_what_ties_them(api, user):
    work = Collection.objects.create(owner=user, name="Work", kind="area")
    clients = Collection.objects.create(owner=user, name="Clients", parent=work)
    plan = Item.objects.create(
        owner=user, kind="note", title="Plan", status="organized"
    )
    plan.collections.add(clients)
    link = Item.objects.create(owner=user, kind="link", url="https://example.com")
    Board.objects.create(
        owner=user,
        title="Map",
        layout={
            **empty_layout(),
            "nodes": [board_node("a", plan), board_node("b", link)],
            "edges": [
                {
                    "id": "e",
                    "source": "a",
                    "target": "b",
                    "label": "cites",
                    "arrow": "end",
                    "stroke": "solid",
                    "color": "",
                },
            ],
        },
    )

    nodes, edges = graph(api)

    assert nodes[str(plan.id)] == {
        "id": str(plan.id),
        "type": "item",
        "kind": "note",
        "status": "organized",
        "label": "Plan",
    }
    assert nodes[str(clients.id)]["type"] == "collection"
    assert nodes[str(link.id)]["label"] == "https://example.com"
    assert set(edges) == {
        (str(plan.id), str(clients.id), "collection"),
        (str(clients.id), str(work.id), "parent"),
        (str(plan.id), str(link.id), "board"),
    }
    assert edges[(str(plan.id), str(link.id), "board")]["label"] == "cites"


def test_notes_link_each_other_by_title(api, user):
    a = Item.objects.create(
        owner=user,
        kind="note",
        title="Ideas",
        body="See [[plan]] and [[Folder/Plan.md|it]], ![[pic.png]], [[Nowhere]]",
    )
    b = Item.objects.create(
        owner=user, kind="note", title="Plan", body="Back to [[Ideas#top]]"
    )

    nodes, edges = graph(api)

    # Both ways count as one tie.
    assert set(edges) == {(str(a.id), str(b.id), "link")}


def test_albums_stand_for_their_images_and_labels(api, user):
    album = Item.objects.create(owner=user, kind="album")
    Item.objects.create(owner=user, kind="image", album=album)
    Item.objects.create(owner=user, kind="image", album=album)
    note = Item.objects.create(
        owner=user, kind="note", body="\nIntro\n# [Read](https://x.y) this\nmore"
    )
    file = Item.objects.create(owner=user, kind="file", metadata={"filename": "a.pdf"})

    nodes, edges = graph(api)

    assert len(nodes) == 3
    assert nodes[str(album.id)]["label"] == "2 images"
    assert nodes[str(note.id)]["label"] == "Read this"
    assert nodes[str(file.id)]["label"] == "a.pdf"
    assert edges == {}


def test_only_your_own(api, other_user):
    Item.objects.create(owner=other_user, kind="note", title="Theirs")
    Collection.objects.create(owner=other_user, name="Theirs")

    assert graph(api) == ({}, {})
