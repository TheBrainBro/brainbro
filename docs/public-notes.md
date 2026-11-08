# Public notes

A note can be published as a page anyone can read, signed in or not: a shared note, an article,
a small blog. Everything else stays private.

## Visibility

Every note is **Private** by default: only its owner can see it. The visibility button in the
note's bar (next to Organize) switches it to **Public**, at once: the note gets an address,
`/@<handle>/<slug>`, with the slug made from its title (`Café & trip plan` is `cafe-trip-plan`;
an untitled note uses the title it shows, its first H1 or first line). The same menu then shows
the link, opens the page and leads to **Page settings**. Switching back to Private takes the
page down. A note filed in a blog's collection lives on the blog's domain instead (see
[blogs.md](blogs.md)).

**Unlisted** is public with no listing: the note opens at the same address, for anyone with
the link, but it is left out of `/@<handle>`, `/p`, a blog's index and categories, its RSS and
its sitemap, and its page carries `<meta name="robots" content="noindex">`. It is not secret:
the address comes from the title, so it can be guessed. `[[links]]` to it from published notes
keep working. Notes are **Public** (listed) unless their owner says otherwise.

- The **handle** is the user's public address on the server, `/@<handle>/`: made from their
  display name the first time they publish (`author` without one), and changed in Settings ›
  Profile. Lowercase letters, numbers and hyphens, 2 to 40, unique on the server; never the
  username, which is half of the login. Changing it breaks links to the old address.
- Slugs are lowercase letters, numbers and hyphens, up to 80 characters, and unique among each
  user's notes: two people can both have an `about`. A slug in use gets a number (`plan-2`);
  one typed by hand that is in use is refused.
- `/p/<slug>`, the address notes had before handles, redirects to where the note is now while
  only one published note on the server has that slug.
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
`twitter:card` tags in the HTML it sends for `/@<handle>/<slug>` (`apps/public/pages.py`, from
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
- **Author**: the page shows its owner's **display name** (Settings › Profile), or `@<handle>`
  without one, and their **profile photo**, leading to their page; the name goes in the
  `author` meta tag. The photo is public only while they have a published note
  (`/api/public/authors/<handle>/avatar/`): someone who publishes nothing never shows theirs.
  The username, half of the login, never shows.

## How it looks

A note reads as an article, under a bar with whose it is (the blog, or its author) that leads
back to all their posts: the date, its title, then its text in larger type with wide images. A
first line `# Title` equal to its title isn't shown twice. Below, up to three more of the
author's notes (on a blog, of the blog's), when there are any, and a link to all posts. Lists (`/@<handle>`, a blog's index, `/p`) show each note with its title, the start of
its text (or its page description), its date and its cover: the image its shared link
shows.
- The page never says which account owns the note, nor where it is filed.

`/@<handle>` is the author's page: their display name (or `@<handle>` without one) and all their
public notes, newest first, each at its address (its blog's, if it is on one). A note's byline
links to it. It is there with or without blogs. It, and notes read on the server's own domain,
end with a small "Powered by BrainBro" line (blogs choose; see [blogs.md](blogs.md)).

`/p` lists every published note on the server, the last published first, each at its address.
Nothing links to it for now.

## API

| Method | Path | |
| --- | --- | --- |
| `PUT` | `/api/items/<id>/publication/` | Makes the note public; `{"listed": false}` makes it unlisted, `true` lists it, without it stays as it was. Returns the note, with `public_slug`, `published_at`, `public_listed` and `public_url` (`/@<handle>/<slug>`, or its blog's full URL). |
| `DELETE` | `/api/items/<id>/publication/` | Makes it private. Returns the note. |
| `GET` | `/api/items/<id>/page/` | `{slug, address, title, description, image, defaults, preview}`: the page settings, what comes before the slug, the defaults and the result. |
| `PATCH` | `/api/items/<id>/page/` | Any of `slug`, `title`, `description`, `image` (a `src` of the note's images, or `"none"`); empty ones go back to their default. |
| `PATCH` | `/api/auth/profile/` | `handle` (and `display_name`): the user's public address. |
| `GET` | `/api/public/notes/` | Anyone: `{slug, title, published_at, url, excerpt, image_url}`, paginated. On a blog's domain, its notes; with `?author=<handle>`, that author's. |
| `GET` | `/api/public/authors/<handle>/` | Anyone: `{handle, author, avatar_url}`, the author's display name and photo. |
| `GET` | `/api/public/authors/<handle>/avatar/` | Anyone, while they have a published note: their photo. |
| `GET` | `/api/public/notes/<handle>/<slug>/` | Anyone: `{slug, handle, title, body, published_at, edited_at, author, avatar_url, images, links, notes}`; `notes` are the `[{url, title}]` its links can lead to. |
| `GET` | `/api/public/notes/<handle>/<slug>/images/<id>/` | Anyone, while published: one of its images. |
| `GET` | `/api/public/notes/<handle>/<slug>/links/<id>/image/` | Anyone, while published: a card's image. |
| `GET` | `/api/public/legacy/<slug>/` | Anyone: `{url}`, where `/p/<slug>` lives now, while one published note has that slug. |

A note never published, or taken down, answers 404 everywhere under `/api/public/`.
