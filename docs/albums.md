# Albums

An album keeps several images as one item, like grouped media in a chat app. Its images stay
items of their own (with their files, thumbnails and URLs), pointing at the album in order
(`Item.album`, `Item.album_position`), and only show up through it: lists leave them out, and
the album's card, its tile and its place on a board show them together.

## Making one

- **Capturing**: two or more images pasted, dropped or shared together are uploaded as usual
  and, once all of them are in, grouped into one album in the order they came in. The capture
  toast says so and offers *Separate*, which ungroups them again; *Undo* removes the album
  and its images. Images captured onto a board stay separate cards.
- **From the inbox or a collection**: select two or more images and pick *Make album*, or
  select images and one album and pick *Add to album*.

## Editing

In the viewer, an album shows one image at a time over a strip of all of them. *Move earlier*
and *Move later* reorder the shown image, *Take out* puts it back on its own, and *Ungroup*
takes the album away, leaving its images where it was. Images that leave an album take its
status (inbox, organized, archived). Deleting an album deletes its images.

## API

| Method | Path | |
| --- | --- | --- |
| `POST` | `/api/items/albums/` | `{"items": [image ids, in order], "title"?}`. A new album in the inbox. At least two images, at most 100, all yours and in no other album. |
| `PUT` | `/api/items/<id>/album-items/` | `{"items": [...]}`: what the album holds, in order. Images left out go back on their own. |
| `POST` | `/api/items/<id>/ungroup/` | Takes the album away and returns its images. |

An album item has `kind: "album"` and `album_items` (its images, serialized like any item);
its `preview_image_url` is its first image's thumbnail. Each image in it has `album` set to
the album's id. `GET /api/items/` leaves images in albums out; fetching one by id still works.
