# Images in notes

A note's images show inside it, in the editor and on its cards, without the app ever loading
them from where the Markdown points: that would tell the site whenever the note or the inbox is
open. The app shows a copy it keeps instead. The Markdown is never rewritten: each copy is a
`NoteImage` row found by the image's `src`, read the way markdown-it reads it (unescaped and
URL-normalized, `<a b.png>` is `a%20b.png`), by the server (`markdown-it-py`) and the frontend
(`imageKey` in `lib/markdown.ts`) alike.

## Remote images

`![alt](https://…)` in a saved note (any save or capture that changes the body):

- A new `src` gets a pending row, and `fetch_note_images` fetches it in the background through
  `safe_http`, re-encoded as a bounded WebP like link previews (raster only, 10 MB, 40 Mpx).
  Temporary errors retry three times; after that, or on a final error, the image is `failed`
  and stays so until it is taken out of the note and put back.
- An image already stored is never fetched again; one taken out of the note is deleted, copy
  included, on that save.
- Only the first 50 images of a note are stored; the rest show their alt text.

## Pasted and dropped images

Images pasted or dropped into the editor upload to `POST /api/note-images/` and are linked
where they were put, as `![name](attachments/<id>.<ext>)`. A placeholder holds the spot while
they upload, and the image shows from the device until the server has its display copy (a
bounded WebP made by `make_note_image_display`). The original is kept for the export.

- Raster images only (`IMAGE_TYPES`, no SVG), up to 20 MB. If the paste or drop holds anything
  else (a PDF, a folder), all of it goes to the inbox as anywhere else. Text copied together
  with a picture of it (a spreadsheet, a document) pastes as text.
- They are not items: they don't show in the inbox, lists, search or boards.
- An upload belongs to no note until a note saves the link to it. Once no note links it (taken
  out, or never saved) it is kept for 7 days, so undo brings it back, then
  `delete_unused_note_images` (daily, from beat) deletes it. Cut from one note and pasted into
  another, it moves with the link.

## What shows

| State | Editor and cards |
| --- | --- |
| Ready | The stored copy, lazy-loaded on cards |
| Pending | The alt text, faded; lists, boards and the open note poll until it's ready |
| Failed | The alt text, struck through, with "Couldn't load this image" |
| Not stored (past 50, other schemes) | The alt text |

In the editor, the line under the cursor shows its Markdown instead, as everything else does.

## API

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/items/<id>/` | Notes carry `images`: `{"<src>": {"status", "url"}}`. |
| `POST` | `/api/note-images/` | Multipart `file`. Returns `{id, src, status, url}`; link it as `src`. |
| `GET` | `/api/note-images/<id>/file/` | The display copy (WebP), for its owner only. Immutable: the URL changes with the file. |

## Export

Copies of remote images go in `notes/images/<note>/01.webp`… in order, and the note's `.md`
points at them; pasted ones go in `notes/attachments/`, where the note already points.
`items.json` keeps the body as written, plus `images: [{src, path}]`. See
[export.md](export.md).
