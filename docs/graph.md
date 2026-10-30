# Graph

`/graph` (the *Graph* icon in the top bar) shows everything as a graph: items
and collections are the dots, and the lines are what ties them.

## What it shows

Built by `apps/graph/graph.py`, served at `GET /api/graph/` as
`{nodes, edges}`.

- **Nodes**: every item (`type: "item"`, with `kind`, `status` and a one-line
  `label`, the same name lists show) and every collection (`type:
  "collection"`, with its `kind`, `color` and `icon`). Images in an album
  aren't nodes: the album stands for them.
- **Edges** (`source`, `target`, `type`, sometimes `label`), one per pair and
  type:
  - `collection`: an item is in a collection.
  - `parent`: a collection sits inside another.
  - `board`: a line drawn between two items on a board, with its label.
  - `link`: a note links another note by its title, as Obsidian does:
    `[[Title]]`, `[[Title|text]]`, `[[Title#heading]]` or `[[Folder/Title.md]]`
    (case doesn't matter). Embeds (`![[…]]`) aren't links.

## The view

- Colors follow the item's kind; collections are bigger, in their own color
  and with their emoji. Archived items are faded. The more lines a dot has,
  the bigger it is.
- **Filters**: each kind of line can be turned off. Dots with no line left are
  hidden unless *Show unconnected* is on (it says how many are hidden).
- **Moving around**: drag the background to pan, scroll or pinch to zoom, drag
  a dot to move it (the rest follows). The view fits everything once the
  layout settles. Labels show when zoomed in (collections' sooner).
- **Hover** a dot to light up it and what it's tied to, with their names.
  **Click** to open it: a collection's page, a note in the editor, anything
  else in the viewer.
- Laid out by a force simulation (`d3-force`) and drawn on a canvas
  (`frontend/src/graph/GraphCanvas.tsx`), so large graphs stay smooth. Changing
  the filters keeps known dots where they were. The page loads with its own
  chunk, like boards.
