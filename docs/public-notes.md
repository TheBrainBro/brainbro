# Public notes

A note can be published as a page anyone can read, signed in or not: a shared note, an article,
a small blog. Everything else stays private.

## Publishing

**Publish** in the note's bar opens the dialog. Publishing gives the note an address,
`/p/<slug>`, with the slug made from its title (`Café & trip plan` is `cafe-trip-plan`; an
untitled note uses the title it shows, its first H1 or first line). The dialog shows the link,
lets the slug change and takes the note down.

- Slugs are lowercase letters, numbers and hyphens, up to 80 characters, and unique across the
  whole server (every user's notes share `/p/`). A slug in use gets a number (`plan-2`); one
  typed by hand that is in use is refused.
- Unpublished, a note keeps its slug: publishing it again brings back the same address, and no
  other note can take it meanwhile.
- Changing the slug breaks links to the old address.
- The page shows the note as it is saved now: edits show up on the next load.

## What the page shows

The note rendered as in the app (`renderNote` in `lib/markdown.ts`): raw HTML is shown as text,
never parsed, and DOMPurify runs on top, so nothing in a note runs as a script. Task boxes are
read-only; embed links play, since the author picked them.

- **Links to other notes** (`[[Title]]`) lead to the other note's page only when that note is
  published too; otherwise they read as plain text. They are resolved against all of the
  owner's notes first, so a title that finds a private note never leads to a public one that
  shares it.
- **Images**: the note's stored copies (see [note-images.md](note-images.md)) and its card
  images are served at public addresses while the note is published, with
  `Cache-Control: public, max-age=300`, so a page taken down stops showing them within minutes
  even behind a cache. Nothing else of the user is served: uploads, other notes' images and
  previews stay behind sign-in.
- The page never says who owns the note, nor where it is filed.

`/p` lists every published note on the server, the last published first.

## API

| Method | Path | |
| --- | --- | --- |
| `PUT` | `/api/items/<id>/publication/` | `{"slug"?}`. Publishes the note, or changes its slug. Returns the note, with `public_slug` and `published_at`. |
| `DELETE` | `/api/items/<id>/publication/` | Takes it down. Returns the note. |
| `GET` | `/api/public/notes/` | Anyone: `{slug, title, published_at}`, paginated. |
| `GET` | `/api/public/notes/<slug>/` | Anyone: `{slug, title, body, published_at, edited_at, images, links, notes}`; `notes` are the `[{slug, title}]` its links can lead to. |
| `GET` | `/api/public/notes/<slug>/images/<id>/` | Anyone, while published: one of its images. |
| `GET` | `/api/public/notes/<slug>/links/<id>/image/` | Anyone, while published: a card's image. |

A note never published, or taken down, answers 404 everywhere under `/api/public/`.

## Not yet

Custom domains are left out of this first version: pages live on the server's own domain.
Pages are rendered in the browser, so link previews on other sites show the app's name, not
the note's.
