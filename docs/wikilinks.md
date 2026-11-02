# Links between notes

A note links another by its title, as Obsidian does: `[[Title]]`,
`[[Title|text]]`, `[[Title#heading]]` or `[[Folder/Title.md]]`. Embeds
(`![[…]]`) aren't links, and neither is anything inside code.

## Which note a link finds

The same everywhere (the graph, the editor and the viewer): saved titles are
tried first, then the title an untitled note gets from its body (its first H1,
or else its first line). Case doesn't matter; if several notes share a title,
the oldest wins.

The server keeps the rule in `apps/items/titles.py` (`linkable_titles`,
`wikilink_target`) and serves it at `GET /api/items/note-titles/` as
`[{id, title}]`, in the order titles are tried. The frontend loads that list
once for the whole app (`notes/NoteTitlesProvider.tsx`) and resolves with
`notes/wikilinks.ts`.

## How they show

- **Viewer** (cards, the full-screen viewer): a link reads as its `text`, or
  else as `Title › heading`. Clicking it opens the note's editor; Mod-click
  opens it in a new tab.
- **Editor** (live preview, `notes/wikilinkEditor.ts`): away from the cursor a
  link reads the same way, in the link color; at the cursor it's the raw text.
  Mod-click opens the note, as with other links in the editor (a plain click
  edits).
- A link to no note is muted with a dashed underline, and clicking it does
  nothing.
- Typing `[[` suggests notes by title as you type; picking one writes
  `[[Title]]` and puts the cursor after it. Titles with `[`, `]`, `|` or `#`
  aren't suggested: a link can't hold them.

Renaming a note, or changing the first line of an untitled one, doesn't update
the links to it.
