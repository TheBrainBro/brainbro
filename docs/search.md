# Search

⌘K (Ctrl+K elsewhere), or the search button in the top bar, opens a palette from any screen,
text fields included. It finds boards and collections by name, and items by what they say:
titles, note text, URLs, link previews (title, description, site, author) and file names.

## Matching

- Items with every word of the query, in any order, come first. Then come items with only
  some of the words, so natural queries ("notes about the trip to Paris") still find
  something. Words shorter than three letters ("a", "to", "de") only make a match when every
  word is there, and don't count in the order: they are in almost everything. Case and accents don't matter:
  `cafe` finds "Café".
- Words match inside longer ones too (`kube` finds "Kubernetes", `example.com/po` a URL), so
  results show up while a word is still being typed.
- **Typos**: a word of four letters or more that appears nowhere as written is taken for a typo
  and matches similar words instead (`kubernets`, `mardown`). A word that does appear is only
  matched as written, so `paris` doesn't bring up "parts" when there are notes about Paris.
- **Meaning**: items about the same thing match without sharing a word, in Spanish, English
  and other languages: "notes about the trip to Paris" finds "Vacaciones en Francia". New or
  edited text is found by meaning within a minute (by its words right away).
- Archived items are included, marked *Archived*. An album's images show up as their album,
  and opening it starts on the image that matched.

## Order

Items matching more words of the query (of three letters or more) come first. Among those matching as many, title
matches come first, then matches on the URL and the link or file details, then the body.
Typos rank below words matched as written, and items that only match through typos (without
every word or a close meaning) come after all the others: a similar word alone is a weak
guess, like `paris` for "para". Closeness in meaning counts more the longer the query: a
single word goes mostly by its matches, a sentence mostly by what it means, but items with
every word still come first. Ties go to the newest item. The palette shows the
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

### Meaning

The `embedder` container (`docker/embedder`) runs `paraphrase-multilingual-MiniLM-L12-v2` with
fastembed (ONNX, CPU only, no PyTorch). The model is built into its image: nothing leaves the
server. It reads about 128 tokens, so each item's text (title, link or file details, body
without URLs) is cut into chunks of up to 400 characters, each starting with the title, and
stored with its 384-number vector in `ItemChunk` (`pgvector`; `apps/items/embeddings.py`).

- **Keeping up:** every minute the worker embeds the items whose `search_text` changed since
  their chunks were made (an MD5 kept in `Item.embedded_hash`), newest first, for up to 45
  seconds. That covers edits, link previews, imports and items from before semantic search,
  with nothing to call on save.
- **Searching:** the query's vector is asked for while searching (a few milliseconds; at most
  2 seconds before giving up). Items whose closest chunk has a cosine similarity of 0.35 or
  more match, up to 50. Their closeness (0 at the threshold, 1 identical) is added to the
  rank, weighted by the number of words of three letters or more in the query, minus a half.
- **No index on the vectors:** each search compares against every chunk of the user's
  items, which takes milliseconds at a personal scale. An HNSW index would drop matches
  filtered out after the index lookup.
- **Without the embedder** (`EMBEDDER_URL` empty, or the container down) search goes by
  words alone, and items wait to be embedded until it is back.
- **Changing the model** means new vectors for everything: a migration that empties
  `ItemChunk` and `embedded_hash` (and changes the dimensions if they differ).

Accents are removed by `brain_unaccent()`, an immutable wrapper around `unaccent()` created by
the migration, since generated columns only accept immutable functions. Default querysets
leave both columns out (`ItemManager`): only searches read them.

## API

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/items/search/?q=<text>` | The best 20 matches as `[{"item", "album_image"}]`, archived included. `album_image` is the id of the image that matched when `item` is an album, else `null`. |
| `GET` | `/api/items/?q=<text>` | The usual list (album images left out, other filters apply), with the same matching, sorted by relevance. The board's *Add items* panel uses it. |
