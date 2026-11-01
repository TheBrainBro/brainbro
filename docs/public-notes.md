# Public notes

A note can be published as a page anyone can read, signed in or not: a shared note, an article,
a small blog. Everything else stays private.

## Visibility

Every note is **Private** by default: only its owner can see it. The visibility button in the
note's bar (next to Organize) switches it to **Public**, at once: the note gets an address,
`/p/<slug>`, with the slug made from its title (`Café & trip plan` is `cafe-trip-plan`; an
untitled note uses the title it shows, its first H1 or first line). The same menu then shows
the link, opens the page and leads to **Page settings**. Switching back to Private takes the
page down.

- Slugs are lowercase letters, numbers and hyphens, up to 80 characters, and unique across the
  whole server (every user's notes share `/p/`). A slug in use gets a number (`plan-2`); one
  typed by hand that is in use is refused.
- A private note keeps its slug: making it public again brings back the same address, and no
  other note can take it meanwhile.
- The page shows the note as it is saved now: edits show up on the next load.

## Page settings

- **Address**: the slug. Changing it breaks links to the old one.
- **Title**, **Description** and **Image**: how the page shows in search results and when its
  link is shared (OpenGraph). Left empty, each takes its default, shown as a placeholder: the
  note's title, the start of its text as plain words (headings and images left out, 160
  characters), its first image. The image can be any of the note's stored images, or none; if
  the chosen one is taken out of the note, the first image is used again.

The page is rendered in the browser, but sites that read a link (chat apps, search engines) run
no JavaScript: the server puts `<title>`, the description, canonical link and `og:*` /
`twitter:card` tags in the HTML it sends for `/p/<slug>` (`apps/public/pages.py`, from
`apps.core.views.spa`). In development the Vite server answers instead, so the tags only show
when Django serves the build.

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

`/p` lists every published note on the server, the last published first. Nothing links to it
for now.

## API

| Method | Path | |
| --- | --- | --- |
| `PUT` | `/api/items/<id>/publication/` | Makes the note public. Returns the note, with `public_slug` and `published_at`. |
| `DELETE` | `/api/items/<id>/publication/` | Makes it private. Returns the note. |
| `GET` | `/api/items/<id>/page/` | `{slug, title, description, image, defaults, preview}`: the page settings, their defaults and the result. |
| `PATCH` | `/api/items/<id>/page/` | Any of `slug`, `title`, `description`, `image` (a `src` of the note's images, or `"none"`); empty ones go back to their default. |
| `GET` | `/api/public/notes/` | Anyone: `{slug, title, published_at}`, paginated. |
| `GET` | `/api/public/notes/<slug>/` | Anyone: `{slug, title, body, published_at, edited_at, images, links, notes}`; `notes` are the `[{slug, title}]` its links can lead to. |
| `GET` | `/api/public/notes/<slug>/images/<id>/` | Anyone, while published: one of its images. |
| `GET` | `/api/public/notes/<slug>/links/<id>/image/` | Anyone, while published: a card's image. |

A note never published, or taken down, answers 404 everywhere under `/api/public/`.

## Not yet

Custom domains are left out of this first version: pages live on the server's own domain.
