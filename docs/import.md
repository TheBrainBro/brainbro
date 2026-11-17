# Import

Settings, Import takes a zip of one of two kinds, told apart by what it holds:

- **A BrainBro export** (the zip from Settings, Export, see [export.md](export.md)),
  to take a brain from one BrainBro to another, for example from a Docker install
  to the Umbrel app. Everything comes back as it was.
- **An Obsidian vault**, zipped. The other direction needs nothing special: the
  full export opens as a vault, boards included as `.canvas` files.

Both are uploaded and run the same way (see [How it runs](#how-it-runs)).

## From a BrainBro export

A zip with `items.json` and `collections.json` at its top (or inside its one
folder, as exports come) is a BrainBro export, and is read from those records
instead of its Markdown files, so nothing is lost on the way
(`apps/imports/brainbro.py`, format in
[`apps/exports/README.md`](../backend/apps/exports/README.md)):

- **Items** keep their kind, status (inbox, organized, archived), title, body,
  URL, metadata, collections and their created and updated dates; in the inbox
  they sort where they did.
  - **Links** stay links, with their preview image and metadata. Only a link
    that had no preview fetched yet gets one fetched here.
  - **Uploads** (images, files, recordings) are their original files, checked
    as any upload is; thumbnails are made again in the background. An upload
    whose file isn't in the export is skipped.
  - **Albums** keep their images in order.
  - **Notes** get back their pasted images and the copies of their web images,
    so those aren't fetched again; web images the export had no copy of are
    fetched as for any note. Wikilinks keep working: they resolve by title.
- **Collections** keep their kind, color, icon, image and nesting. A
  collection with the same name (in any case) at the same level as one you
  already have is merged into yours, which keeps its own look.
- **Boards** come from `boards/<board>.json`, the full canvas: pen drawings,
  dashed lines and natural sizes included, pointing at the imported items.
  Items that aren't in the export are left out, with their connections. The
  `.md` and `.canvas` copies are not read.
- **Ids:** everything keeps its id when no one on this server has it yet;
  otherwise it gets one made from the old id and your account, the same on
  every import. Something whose id you already have is already here (imported
  before, or never deleted) and is left as it is, counted as `existing`. So
  importing the same export twice adds nothing, and importing it after
  deleting a few things brings back just those.
- **Versions:** an export with a newer `export_version` than this server
  writes is refused, asking to update the server first.
- **Not in an export, so not imported:** version history, public pages and
  blogs, API tokens and Telegram. The result says so. Moving a whole server
  (every user and all of that) is a database backup ([backups.md](backups.md)).

## From an Obsidian vault

- **Folders** become collections, nested as they were. A collection is only
  made for a folder that ends up holding something (a folder with nothing but
  images that notes embed doesn't get one). A top-level folder whose name is
  already taken at the top of your collections gets ` 2`, ` 3`… (collections
  side by side can't share a name).
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

- `POST /api/imports/` with the zip as `file` (multipart); the import's `source`
  (`brainbro` or `obsidian`) says what the zip was taken for. It must be a zip of
  at most `IMPORT_MAX_SIZE` (100 MB by default, Cloudflare's cap), whose files
  (hidden ones aside) add up to at most 10 times that once unzipped, so a small
  zip can't fill the disk. Answers 202
  with the import, or 409 while another one is running (one pending for over
  the time limit counts as stuck).
- The Celery task `apps.imports.tasks.run_import` reads the zip from storage
  and imports everything **in one transaction**: if anything goes wrong,
  nothing is created, and the files already stored are deleted. Thumbnails,
  link previews and note image copies are queued once it commits.
- With a storage quota (`STORAGE_QUOTA`, see [deployment.md](deployment.md#storage-quota)),
  the zip itself doesn't count, but every image and file it stores does: if one doesn't fit
  in what is left, the import fails and nothing is imported. With nothing left at all, the
  upload is refused straight away.
- The zip is deleted once read, whatever the outcome. The import keeps
  `counts` (`notes`, `images`, `files`, `links`, `albums`, `boards`,
  `collections`, `existing`, `skipped`) or an `error` to show. The Settings
  page shows each kind's last import in its own card.
- `GET /api/imports/` (newest first) or `/api/imports/<id>/`. The dialog
  polls while `status` is `pending`, and refetches everything when the import
  is done.

Importing the same vault twice imports it twice: nothing is matched against
what's already there. A BrainBro export is matched by its ids (see above).
