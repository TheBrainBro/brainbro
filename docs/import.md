# Import from Obsidian

*Import from Obsidian* in the account menu takes an Obsidian vault, zipped,
and brings it into BrainBro. The other direction needs nothing special: the
[full export](export.md) opens as a vault, boards included as `.canvas` files.

## What becomes what

- **Folders** become collections, nested as they were. A collection is only
  made for a folder that ends up holding something (a folder with nothing but
  images that notes embed doesn't get one). A name that's already taken gets
  ` 2`, ` 3`… (collection names are unique per account).
- **Where things land:** what sits in a folder is organized into its
  collection; what sits at the top of the vault lands in the inbox.
- **Markdown files** become notes, titled with the file name.
  - Images a note embeds (`![[photo.png]]`, `![[photo.png|The beach]]`,
    `![](assets/photo.png)`) become the note's own images, as if pasted into
    it, and the note links them as `attachments/<id>.<ext>`. `|300` sizes are
    dropped; any other text after the bar becomes the image's alt text.
  - Properties (the YAML front matter) become a `yaml` code block at the top,
    so they stay readable. The front matter of a BrainBro export's own notes
    (with `id` and `kind`) is dropped.
  - Wikilinks between notes (`[[Other note]]`) and embeds of anything that
    isn't an image are kept as written.
- **Other files** become image or file items, detected by content as any
  upload is: images that no note embeds, PDFs, everything else.
- **Canvases** (`.canvas`, [JSON Canvas](https://jsoncanvas.org/spec/1.0/))
  become boards named after the file (see `apps/boards/canvas.py`):
  - `file` nodes are the imported items. An image a canvas shows becomes an
    item even if a note embeds it too.
  - `link` nodes become link items, placed like a file in the canvas's folder,
    with their preview fetched in the background.
  - `text` nodes, and files or links that couldn't be found, become sticky
    notes. `group` nodes become frames, nested by which box holds which.
  - Items on a board leave the inbox, as when placed by hand.
  - Preset colors map to the board's palette; an arrow only at the start of
    an edge turns the edge around.
- **Skipped:** hidden folders and files (`.obsidian`, `.trash`, `.DS_Store`),
  `__MACOSX`, files over `UPLOAD_MAX_SIZE`, notes over 1 MB, canvases over
  5 MB or that aren't JSON. The result counts what was skipped.

A vault zipped as its folder (`My vault/…`) or from inside it both work.

## How it runs

- `POST /api/imports/` with the zip as `file` (multipart). It must be a zip of
  at most `IMPORT_MAX_SIZE` (100 MB by default, Cloudflare's cap). Answers 202
  with the import, or 409 while another one is running (one pending for over
  the time limit counts as stuck).
- The Celery task `apps.imports.tasks.run_import` reads the zip from storage
  and imports everything **in one transaction**: if anything goes wrong,
  nothing is created, and the files already stored are deleted. Thumbnails,
  link previews and note image copies are queued once it commits.
- The zip is deleted once read, whatever the outcome. The import keeps
  `counts` (`notes`, `images`, `files`, `links`, `boards`, `collections`,
  `skipped`) or an `error` to show.
- `GET /api/imports/` (newest first) or `/api/imports/<id>/`. The dialog
  polls while `status` is `pending`, and refetches everything when the import
  is done.

Importing the same vault twice imports it twice: nothing is matched against
what's already there.
