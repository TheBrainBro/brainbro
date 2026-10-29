# Boards

A board is an infinite canvas: items laid out in space. The `Board` row holds a
title, a `layout` JSON document and a `revision` counter. The layout is the
source of truth for what is on the board and where; `Board.items` mirrors its
item nodes so the database can tell which boards an item is on.

## Layout schema (version 1)

```json
{
  "schema_version": 1,
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [
    {
      "id": "n-3f2a",
      "type": "item",
      "item": "6b1e…-uuid",
      "x": 120, "y": -40,
      "w": 320, "h": null,
      "parent": null
    }
  ],
  "groups": [
    {
      "id": "g-1", "title": "Ideas", "color": "#3b82f6",
      "x": 0, "y": 0, "w": 800, "h": 600, "parent": null
    }
  ],
  "edges": [
    { "id": "e-1", "source": "n-3f2a", "target": "g-1", "label": "" }
  ]
}
```

- **`viewport`**: pan (`x`, `y`) and `zoom` (0.01 to 10) when the layout was last saved.
- **Nodes**: `id` is chosen by the client (letters, digits, `-` and `_`, up to 64). `type` is
  `item` for now, which needs `item` (the UUID of one of your items). An item appears at most
  once per board. `x` and `y` are the top-left corner, relative to the `parent` group if there is
  one. `w` and `h` are optional: `null` means the node's natural size.
- **Groups** (frames): a box with a title and an optional hex color. Groups can be nested
  through `parent`. Nodes and groups share one id space.
- **Edges**: `source` and `target` are node or group ids, with an optional `label`.

Coordinates are limited to ±1,000,000 and sizes to 1–10,000. A board holds at most 2,000 nodes,
500 groups and 4,000 edges. Unknown keys are dropped on save.

### Versioning

Every layout carries `schema_version`. Adding an optional field or a new node type keeps the
version: old layouts still read the same. Anything that would change the meaning of a stored
layout bumps it and adds a step to `MIGRATIONS` in `backend/apps/boards/layout.py`. Layouts
are migrated whenever they are read, so the rest of the code only sees the current version.
Saves must send the current version.

### Items that go away

A deleted item drops out of `Board.items` (cascade), and its node is filtered out when the
board is read; the next save removes it for good, along with any edges that pointed at it.
Archived items keep their node. The first time an inbox item is placed on a board it becomes
`organized`; taking it off a board doesn't send it back to the inbox.

## API

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/boards/` | Your boards, most recently changed first, with `item_count` (no layout). |
| `POST` | `/api/boards/` | `{"title": "…"}`. Starts with an empty layout, revision 1. |
| `GET` | `/api/boards/<id>/` | The board with its `layout` and the `items` its nodes point at. `ETag: "<revision>"`. |
| `PATCH` | `/api/boards/<id>/` | Rename. Doesn't change the revision. |
| `PUT` | `/api/boards/<id>/layout/` | Replace the layout. Needs `If-Match: "<revision>"`. |
| `DELETE` | `/api/boards/<id>/` | Delete the board. Its items stay. |

Saving the layout returns the new `revision` and the layout as stored (with nodes of missing
items removed). Without `If-Match` it answers 428. If someone saved since that revision, it
answers 412 with the whole current board, so the client can show the conflict instead of
overwriting it. An invalid layout answers 400 with `detail` and the `path` of the first problem
(for example `nodes[3].x`).

## Canvas

`/boards` lists your boards; `/boards/<id>` opens one in the canvas (React Flow, loaded with the
first board you open).

- **Placing items**: *Add items* lists your inbox (or everything). *Add* puts a card in the first
  free spot near the middle of the view; dragging a row onto the canvas puts it under the pointer.
- **Pasting and dropping**: while a board is open, a paste outside a text field and a drop on the
  canvas land on the board instead of only in the inbox. Links, text and files go through the same
  capture pipeline as anywhere else (size checks, upload progress, at most three uploads at a time):
  a dashed card shows where each one will go, under the pointer (several stack downwards), and
  becomes the real card once its item exists. A paste goes where the pointer last was over the
  canvas, or near the middle. If a capture fails the card stays there in red with *Retry* and
  *Dismiss*, and it retries by itself when the network comes back; closing the page with captures
  still pending asks first. There is no Undo toast here: ⌘Z takes the card off the board and the
  item stays. A drop outside the canvas (the header) is an ordinary capture into the inbox.
- **Item status**: an inbox item becomes `organized` with the first save of a layout that has it.
  Pasted and dropped items are created in the inbox like any capture and organized by that save;
  one whose capture finishes after you leave the board stays in the inbox.
- **Editing the layout**: drag cards, resize the selected one from its corners, select several
  with ⌘/Ctrl-click or by dragging a box with Shift, and press Delete or Backspace to take them
  off the board (the items stay). Undo and redo (⌘Z, ⇧⌘Z) step through these changes.
- **Cards**: notes render their Markdown (tasks can be ticked), links their preview, images and
  files their thumbnail. Double-click a note to edit it in place (Esc to finish); it saves like
  the note page. Double-click anything else, or use *Open*, to see it in the side panel.
- **Saving**: every finished gesture is an undo step, and the layout saves once changes stop for
  a second (at most five seconds after the first unsaved one), one request at a time, so moving
  several cards in a row is a single save. Undo and redo save the same way, and nothing is sent if
  they land back on what was saved. Panning and zooming alone are not saved.
- **Offline and closing**: the unsaved layout is kept on this device (`localStorage`, by board)
  until the server has it. Failed saves retry with backoff (2 s up to 30 s) and straight away when
  the network seems back; the indicator shows *Offline* meanwhile. Hiding or closing the page sends
  what is pending with `keepalive` when the layout fits under 60 KB (browsers cap keepalive
  requests at 64 KiB); bigger ones rely on the draft. Opening the board again brings a draft back
  as one undoable change: saved if it was made on the revision the server still has, or shown with
  the conflict banner if someone saved since.
- **Conflicts**: if another tab or device saved first, saving stops and the board says so; edits
  go on locally (and into the draft) until you load theirs or keep yours.
- **Large boards**: only cards in view are rendered, and below 40% zoom cards show just their
  kind and title.
- **Phones**: boards are read-only. Pan, pinch to zoom, and tap a card to open it in a sheet.
  Pastes and drops there are ordinary captures into the inbox.
