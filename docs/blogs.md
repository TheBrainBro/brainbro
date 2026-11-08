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
by then, the blog stops showing. Changing a blog's domain means verifying it again.

## What a blog shows

- `/`: its name (the blog's title, or the collection's name) and description, then its notes.
- `/<slug>`: a note, as on its public page (see [public-notes.md](public-notes.md)). Links to
  other notes on the blog stay on it; links to notes elsewhere lead to wherever those live (their
  own blog), or read as plain text if they have no blog.
- `/rss` (the feed, served as plain XML so browsers show it), `/sitemap.xml`, `/robots.txt`.
  `rss` is never a note's slug: a note titled "RSS" gets `rss-2`.

Its notes are the **public** notes **filed directly in** its collection: private ones, and those
in collections inside it, don't show. A note on a blog lives there: its address on the server
(`/@<handle>/<slug>`) redirects to the blog, and its link in the app is the blog's. If it is on
several blogs, the oldest one wins.

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
| `GET`, `POST` | `/api/sites/` | The user's blogs; a new one (`hostname`, `collection`, `title`, `description`). |
| `GET`, `PATCH`, `DELETE` | `/api/sites/<id>/` | One of them. A new `hostname` is unverified again. |
| `POST` | `/api/sites/<id>/verify/` | Checks its `TXT` record in the worker; `status` goes `checking`, then `verified` or `failed`. |
| `GET` | `/api/public/site/` | Anyone, on a blog's domain: `{hostname, title, description, author, handle}`. 404 elsewhere. |
| `GET` | `/api/public/sites/check/?domain=` | Anyone: `200` for a verified blog's domain, `404` otherwise. For Caddy's `ask`. |

Each blog in `/api/sites/` has `records`: the DNS records to add, as `{type, name, value}`.
