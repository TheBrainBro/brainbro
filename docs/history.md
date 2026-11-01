# Version history

Notes and boards keep their history, so you can see what an assistant (or
you, on another device) changed, and go back. See `apps/history/`.

## What is kept

Every save that changes a note's title or body, or a board's title or layout,
leaves a **revision**: the content as saved, who saved it (you, or the app's
name) and through what (`web`, `telegram`, `mcp`, `api`, `import`; see
[origin.md](origin.md)). The newest revision is always what the note or board
holds now.

Autosave saves every few seconds, so saves by the same author within five
minutes of a revision's start go into it instead of making a new one. A save
by someone else always starts a new revision. Moving around a board (panning,
zooming) is not a change.

Revisions are kept for as long as their note or board exists, and go with it
when it is deleted. Notes and boards from before the history existed start
with one revision: what they held then.

## Restoring

Restoring saves the old content again as a **new** revision, marked as
restored from the old one: nothing in the history is lost, and a restore can
itself be undone by restoring the revision before it. Nothing goes into a
restore afterwards, even within the five minutes.

- A note gets its title and body back. Open in the app, it changes there
  live, like an assistant's edit (see [live-editing.md](live-editing.md)).
- A board gets its title and layout back, and where you are looking stays
  as it is. Like any layout save, cards put back take their items out of the
  inbox, items taken off with nowhere else to be go back to it, and cards of
  items deleted since are left out. A tab with unsaved changes on that board
  gets the usual conflict.

## In the app

- **Notes**: *History* in the viewer's header. Pick a revision to see what
  changed since (lines added and removed) or the note as it was, and restore
  it.
- **Boards**: *History* in the board's header opens a panel over the canvas:
  the revisions and, for the one picked, what changed since in words (cards
  added and removed, sticky notes edited, frames, connections, drawings, how
  many cards were moved).

## In the API

- `GET /api/revisions/?item=<id>` or `?board=<id>`: the history, newest
  first (paginated), without the content.
- `GET /api/revisions/<id>/`: one revision with its content: `body` for a
  note; `layout` (in the current schema) and the `items` on it that still
  exist for a board.
- `POST /api/revisions/<id>/restore/`: restores it; returns the note, or the
  board as `GET /api/boards/<id>/` does.

Each revision has `by` (empty for you), `via`, `restored_from` and
`restored_from_at`, `created_at` (when it started) and `updated_at` (its last
save).

## For assistants (MCP)

`list_revisions` lists a note's history and `get_revision` reads one version
in full. Restoring stays something only you do, in the app (see
[mcp.md](mcp.md)).
