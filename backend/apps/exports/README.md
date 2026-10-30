# Brain export

Everything you had in Brain when this export was made: notes, links, images,
files, albums, collections and boards. Everything you need is in plain files
(Markdown, JSON and your originals), so you can open them without Brain.

## What's in here

```
README.md          this file
items.json         every item with all its data, and where its file is
collections.json   your collections and the items in each
collections/       the image of each collection, when it had one
notes/             one Markdown file per note
notes/attachments/ images you pasted into notes
notes/images/      copies of the web images in each note, a folder per note
links/             one Markdown file per link
links/previews/    the preview image of each link, when it had one
images/            your images, as you uploaded them
files/             your other files, as you uploaded them
albums/<album>/    the album's images in order, plus album.md
boards/            each board three times: <board>.json (the full canvas),
                   <board>.md (an outline you can read) and <board>.canvas
                   (for Obsidian and other JSON Canvas apps)
```

Archived items are included; their `status` says so. Thumbnails aren't: they
can be made again from the originals.

## Names

Files are named after the item's title. Without one, a note uses its first
line, a link its page title or site, and an upload its original file name.
Characters that aren't allowed in file names on Windows or macOS are replaced
with spaces, and names are cut at 100 characters. When two names clash in a
folder (ignoring case), the later one gets ` 2`, ` 3`… in the order the items
were created. Album images are numbered by their position (`01 Beach.jpg`).

## Notes and links

Notes are your Markdown, as you wrote it, under a YAML front matter block that
Obsidian and most Markdown editors understand:

```yaml
---
id: "6b1e0c2a-…"
kind: "note"
status: "organized"
title: "Shopping list"
collections: ["Home"]
created: 2026-10-29T10:12:00+00:00
updated: 2026-10-29T10:15:31+00:00
---
```

Empty fields are left out.

Images in a note open from this export, without the internet: images you
pasted into a note are in `notes/attachments/`, where the note already points.
For images from the web, Brain kept a copy: they are in
`notes/images/<note>/` (`01.webp`, `02.webp`… in order) and the note's
Markdown here points at them. An image Brain had no copy of keeps its web
address.

Links have the same block plus `url`, `site` and
`author`; below it come the link, its preview image, the page's description
as a quote, and your own notes about it.

## items.json

The full record of every item, including the ones that are only a file:

```json
{
  "export_version": 1,
  "exported_at": "2026-10-29T12:00:00+00:00",
  "items": [
    {
      "id": "…",
      "kind": "note | link | image | file | album",
      "status": "inbox | organized | archived",
      "title": "",
      "body": "Markdown",
      "url": "links only",
      "metadata": {},
      "collections": ["collection ids"],
      "album": "the album id, for images in an album, else null",
      "album_position": 0,
      "created_at": "…",
      "updated_at": "…",
      "path": "notes/Shopping list.md",
      "preview_path": "links/previews/….webp",
      "images": [{ "src": "https://…/photo.jpg", "path": "notes/images/Shopping list/01.webp" }]
    }
  ]
}
```

- `path` is where the item is in this export, from the folder this README is
  in. It is `null` for an upload whose file was missing.
- `album_position` is only there for images in an album; `preview_path` only
  for links with a preview image.
- `images` is only there for notes with images in this export: each image's
  `src`, as in `body` (read the way Markdown reads it, so `<a b.png>` is
  `a%20b.png`), and where its file is. `body` is always the note as you wrote
  it; only the note's `.md` file points at these files.
- `metadata` is what Brain found out about the item. For links: `title`,
  `description`, `site_name`, `author`, `image_url`, `final_url`… For
  uploads: the original `filename`, its `mime` type, `size` in bytes and, for
  images, `width` and `height`.

## collections.json

A list of `{id, name, kind, color, icon, image, parent, created_at, items}`.
`kind` is `project`, `area` or `resource`; `icon` is an emoji and `color` a
hex color, both optional; `image` is the path of its image in this export, or
null; `parent` is the id of the collection it sits in, or null at the top;
`items` are item ids, as in `items.json`.

## Boards

`<board>.md` is the board as an outline: the items and sticky notes that sit
directly on the canvas, then each frame as a heading with what's inside it
(frames inside frames are deeper headings), from top to bottom, then the
connections. Items link to their file in this export. Pen drawings only make
sense on the canvas, so the outline just counts them.

`<board>.json` keeps the whole canvas:

```json
{
  "id": "…",
  "title": "Ideas",
  "created_at": "…",
  "updated_at": "…",
  "layout": {},
  "items": {
    "<item id>": { "kind": "note", "title": "Shopping list", "path": "notes/Shopping list.md" }
  }
}
```

- `items` says, for every item on the board, what it is and where its file is
  in this export (from the folder this README is in).
- `layout` is the canvas itself (`schema_version` 1):
  - `viewport`: where the view was, `{x, y, zoom}`.
  - `nodes`: `{id, type, x, y, w, h, parent}`. `type` is `item` (with `item`,
    an item id), `sticky` (with `text` and `color`) or `stroke` (a pen line:
    `points` as `[x, y]` pairs from the stroke's corner, `color` and `width`).
  - `groups` (frames): `{id, title, color, x, y, w, h, parent}`.
  - `edges` (connections): `{id, source, target, label, arrow, stroke,
    color}`. `source` and `target` are node or group ids; `arrow` is `end`,
    `none` or `both`; `stroke` is `solid` or `dashed`.
  - Positions are in canvas pixels, `y` grows downwards. A node or group with
    a `parent` is positioned from that frame's corner. `w` or `h` can be
    `null`: the node takes its natural size. Colors are hex (`#3b82f6`) or
    empty for the default.

`<board>.canvas` is the same board in the [JSON Canvas](https://jsoncanvas.org)
format, so the export folder opens as an Obsidian vault with its boards.
Items are `file` nodes pointing at their file in this export, sticky notes are
`text` nodes and frames are `group` nodes. Pen drawings and dashed lines have
no equivalent there and are left out; cards that take their natural size get a
default one.
