# Blogs on your own domain

A collection can be a blog on a domain of yours: `https://blog.example.com/` lists the public
notes filed in it, newest first, and each one is at `https://blog.example.com/<slug>`, with no
`/@<handle>/` in front. Settings › Blogs.

## Adding one

1. **Settings › Blogs**: enter the domain (`blog.example.com`) and pick the collection.
2. Add the DNS records BrainBro shows, where the domain is managed:

   | Type | Name | Value | What for |
   | --- | --- | --- | --- |
   | `CNAME` | `blog.example.com` | the server (`SITE_CNAME_TARGET`, or the host BrainBro is opened on) | Visits reach BrainBro |
   | `A` | `example.com` | the server's IPv4 (`SITE_IPV4`) | Only for a root domain, which many DNS providers can't give a `CNAME`; only shown when `SITE_IPV4` is set |
   | `TXT` | `_brainbro.blog.example.com` | `brainbro-site-verification=<token>` | Proves the domain is yours |

   Behind a tunnel, the domain is added to the tunnel instead of the `CNAME` (see below). The
   `TXT` record is always needed.
3. **Verify**. The worker looks the `TXT` record up; found, the blog is verified and the domain
   shows it.

Only someone who controls a domain's DNS can add its `TXT` record, so nobody can put a blog on
someone else's domain. A domain is unique once verified: adding one that isn't yours, unverified,
never keeps its owner out. Verify again after changing the records; if the `TXT` record is gone
by then, the blog stops showing.

## Changing a blog's domain

The pencil next to a blog's domain changes it, keeping the blog as it is: its collection, name,
links and redirects. A blog that was never verified just changes domain. A verified one keeps
serving at its current domain while the new one stays pending:

1. Enter the new domain. BrainBro shows that domain's DNS records.
2. Add them, and behind a tunnel add the domain to the tunnel.
3. **Verify**. Found, the blog moves to the new domain with no downtime, and the old one stops
   showing it: it does not redirect. Not found, nothing changes and you can try again.

**Keep current domain** calls the change off. If another blog verifies the new domain first, the
check fails and the blog stays where it is.

## What a blog shows

- `/`: its photo (its owner's), name (the blog's title, or the collection's name), description
  and links, its categories as tabs, then its notes, newest first.
- `/c/<slug>`: the notes of one category.
- `/<slug>`: a note, as on its public page (see [public-notes.md](public-notes.md)). Links to
  other notes on the blog stay on it; links to notes elsewhere lead to wherever those live (their
  own blog), or read as plain text if they have no blog.
- `/rss` (the feed, served as plain XML so browsers show it), `/sitemap.xml`, `/robots.txt`.
  `rss` is never a note's slug: a note titled "RSS" gets `rss-2`.
- At the end of its pages, a small "Powered by BrainBro" line linking to brainbro.app, unless
  turned off in its settings.

Its notes are the **public** notes filed in its collection **or in any collection inside it**,
at any depth. A note on a blog lives there: its address on the server (`/@<handle>/<slug>`)
redirects to the blog, and its link in the app is the blog's. If it is on several blogs, the
oldest one wins.

**Categories** are the collections right inside the blog's, each at `/c/<slug>` with the slug
made from its name (a number added when two make the same one). Their own collections belong
to them. Only categories with something published show. Renaming a collection changes its
category's address.

**Links**: up to 10, each a name and a web address (`https://` or `http://`), shown under the
description.

Nothing of the app is reachable from a blog's domain: it has URLs of its own
(`config/site_urls.py`), with no login, admin or private API, and no cookies reach the server
from there.

## Getting traffic to it, with HTTPS

BrainBro routes by the domain a request arrives for (`apps.public.sites.SiteMiddleware`): its own
hostnames (`APP_HOSTNAMES`) get the app, a verified blog's domain gets the blog, and anything else
gets 400. How the request gets there, and who gives the domain its HTTPS certificate, depends on
the server:

| Server | Certificate | The blog owner's DNS |
| --- | --- | --- |
| Public IP, ports 80 and 443 open (a VPS, a hosted instance) | Caddy, on demand | `CNAME` (or `A`) + `TXT` |
| No open ports, behind a tunnel (Umbrel) | The tunnel provider | Domain added to the tunnel + `TXT` |

### With a public IP: Caddy

The production stack has an optional `caddy` service (`docker/caddy`): start it with the
`caddy` profile (`COMPOSE_PROFILES=caddy`). It serves the app at `APP_HOSTNAMES` and every other
domain with a certificate it gets the first time the domain is visited, from Let's Encrypt. Before
getting one, it asks BrainBro (`GET /api/public/sites/check/?domain=<domain>`, `200` or `404`)
whether the domain is a verified blog's, so nobody can make it request certificates for domains
that aren't. The first visit to a new blog takes a few seconds longer.

Set `SITE_CNAME_TARGET` to the hostname blogs point their `CNAME` at, and `SITE_IPV4` to the
server's public IPv4 for root domains.

### Behind a tunnel: add the domain to it

A `CNAME` to a hostname served by a tunnel is not enough: the tunnel answers only the hostnames
in its own list (404 otherwise), and Cloudflare refuses a `CNAME` between different accounts. So
each blog's domain is added to the tunnel, pointing at BrainBro like the app's. With Cloudflare
Tunnel: **Zero Trust › Networks › Tunnels › your tunnel › Public hostname › Add**, the blog's
domain, and the same service as BrainBro's hostname. Cloudflare creates the DNS record and the
certificate. Then add the `TXT` record and verify.

This works for domains in the tunnel owner's own Cloudflare account, which suits a server with
one or a few people on it.

## API

| Method | Path | |
| --- | --- | --- |
| `GET`, `POST` | `/api/sites/` | The user's blogs; a new one (`hostname`, `collection`, `title`, `description`, `links`, `powered_by`). |
| `GET`, `PATCH`, `DELETE` | `/api/sites/<id>/` | One of them. A verified blog's new `hostname` goes to `pending_hostname` and it keeps serving; sending its current `hostname` calls that off. On a blog never verified, `hostname` just changes. |
| `POST` | `/api/sites/<id>/verify/` | Checks its `TXT` record in the worker; `status` goes `checking`, then `verified` or `failed`. On a blog with a `pending_hostname` it checks that domain and `pending_status` says so instead; found, the blog moves there. |
| `GET` | `/api/public/site/` | Anyone, on a blog's domain: `{hostname, title, description, author, handle, avatar_url, links, powered_by, categories}`; `categories` are `[{slug, name}]`. 404 elsewhere. |
| `GET` | `/api/public/notes/?category=<slug>` | Anyone, on a blog's domain: the notes of one of its categories. |
| `GET` | `/api/public/sites/check/?domain=` | Anyone: `200` for a verified blog's domain, `404` otherwise. For Caddy's `ask`. |

Each blog in `/api/sites/` has `records`: the DNS records to add, as `{type, name, value}`.
