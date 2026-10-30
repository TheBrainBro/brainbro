# Export

Everything a user has, as a zip they can take anywhere: notes and links as
Markdown, boards as JSON plus a readable outline, and uploads as the original
files. It is not a backup of the app (that's the `pg_dump` in
[deployment.md](deployment.md#backups)): it's for the user, and has to make
sense without Brain.

## The format

The format is documented for whoever opens the zip in
[`backend/apps/exports/README.md`](../backend/apps/exports/README.md), which is
copied into every export. That file is the reference: change it together with
`apps/exports/archive.py`, and bump `EXPORT_VERSION` if an existing field
changes meaning.

## How it's built

- **Start:** "Export everything" in the account menu → `POST /api/exports/`.
  If an export is already being built it's returned (200). Otherwise the
  previous one is deleted and a new one is queued (202): only the latest
  export is kept.
- **Build:** the Celery task `apps.exports.tasks.build_export` writes
  `EXPORT_DIR/<id>.partial` and renames it to `<id>.zip` when it's complete.
  It has its own time limit (2 hours); an export still `pending` after that is
  considered stuck and the next `POST` starts a new one. On any error the
  export is `failed` and the partial file is removed.
- **Status:** `GET /api/exports/` (newest first) or `/api/exports/<id>/`. The
  dialog polls while `status` is `pending`.
- **Download:** `GET /api/exports/<id>/download/`, authenticated, only when
  `ready`.
- **Retention:** `delete_old_exports` runs hourly from beat and deletes
  exports older than `EXPORT_RETENTION_HOURS` (24), with their files.

`EXPORT_DIR` (`/data/exports`, the `exports` volume) must be shared by `api`,
which serves the zips, and `worker`, which writes them. It lives outside
`STORAGE_PATH`.

## Choices

- **Not streamed in the request.** An export copies every upload and can be
  gigabytes; built in the background it doesn't hold a gunicorn worker, and a
  dropped download can be retried without rebuilding.
- **Folders by kind**, not by collection or status: collections are
  many-to-many, so folders would duplicate files. Status and collections go in
  the front matter and `items.json`.
- **Names from titles**, cleaned for Windows and macOS and numbered on clashes
  (case-insensitive), so the export reads well in a file browser or Obsidian.
- **Thumbnails are left out** (they come from the originals); link preview
  images are kept, since the page may be gone.
- **Note images go next to the note** ([note-images.md](note-images.md)):
  pasted ones in `notes/attachments/`, the path the note already links, and
  copies of remote ones in `notes/images/<note>/`. Only the exported `.md`
  points at those copies (inline images; reference-style ones keep their
  URL); `items.json` keeps the body as written, with an `images` list.
- **Boards as JSON Canvas too:** each board also goes out as `<board>.canvas`,
  so the export opens in Obsidian with its boards (see [import.md](import.md)
  for the other direction).
- **Boards keep their layout as is** (migrated to the current
  `schema_version` and without items that no longer exist), plus an `items`
  map from item id to its path in the export, and a Markdown outline.
- **Zip entries** carry the item's `updated_at` as their date. Generated text
  is deflated; uploads are stored as is unless they're text.
