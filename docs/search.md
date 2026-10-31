# Search

⌘K (Ctrl+K elsewhere), or the search button in the top bar, opens a palette from any screen,
text fields included. It finds boards and collections by name, and items by what they say:
titles, note text, URLs, link previews (title, description, site, author) and file names.

## Matching

- Items with every word of the query, in any order, come first. Then come items with only
  some of the words, so natural queries ("notes about the trip to Paris") still find
  something. Words shorter than three letters ("a", "to", "de") only count when every word
  matches: on their own they would bring up almost everything. Case and accents don't matter:
  `cafe` finds "Café".
- Words match inside longer ones too (`kube` finds "Kubernetes", `example.com/po` a URL), so
  results show up while a word is still being typed.
- **Typos**: a word of four letters or more that appears nowhere as written is taken for a typo
  and matches similar words instead (`kubernets`, `mardown`). A word that does appear is only
  matched as written, so `paris` doesn't bring up "parts" when there are notes about Paris.
- Archived items are included, marked *Archived*. An album's images show up as their album,
  and opening it starts on the image that matched.

## Order

Items matching more words of the query come first. Among those matching as many, title
matches come first, then matches on the URL and the link or file details, then the body.
Typos rank below words matched as written. Ties go to the newest item. The palette shows the
best 20 items, under up to five boards and five collections.

## Opening a result

↑ ↓ move, Enter opens. Boards and collections open their page. Items open in the
[viewer](viewer.md), where ← → go through the other results; ⌘Enter (Ctrl+Enter) opens a note
in the editor instead. Esc or ⌘K closes the palette.

The capture box keeps `/` to focus it; ⌘K used to focus it too.

## How it works

Each item has two columns that Postgres generates and keeps up to date on every save
(`apps/items/search.py`):

- `search_text`: the title, URL, preview and file details and body, lowercased and without
  accents, with a trigram index (`pg_trgm`). Matching runs on it: a substring match per word,
  or trigram word similarity (threshold 0.5) for a typo. An item matches with every word, or
  with any word of three letters or more.
- `search_vector`: the same text as a weighted `tsvector` (title A, details B, body C) with the
  `simple` configuration, so Spanish and English words are both kept as written. Ranking uses
  it: `ts_rank` on word prefixes, plus a small share of the trigram similarity. The `rank`
  of a result is the number of words it matches plus that relevance, squeezed below 1.

Accents are removed by `brain_unaccent()`, an immutable wrapper around `unaccent()` created by
the migration, since generated columns only accept immutable functions. Default querysets
leave both columns out (`ItemManager`): only searches read them.

## API

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/items/search/?q=<text>` | The best 20 matches as `[{"item", "album_image"}]`, archived included. `album_image` is the id of the image that matched when `item` is an album, else `null`. |
| `GET` | `/api/items/?q=<text>` | The usual list (album images left out, other filters apply), with the same matching, sorted by relevance. The board's *Add items* panel uses it. |
