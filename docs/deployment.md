# Deployment

BrainBro runs as a Docker Compose stack on a server of yours. This page covers installing it,
the three ways to reach it (a Cloudflare Tunnel, Caddy, or only your local network), every
setting, what the admin can see, upgrading, and Umbrel. Backups are in
[backups.md](backups.md), and installing the app on a phone in [pwa.md](pwa.md).

## What runs

```
Browser ── Cloudflare Tunnel, Caddy, or nothing ──► api :8420 (uvicorn + Django + static frontend)
                                                      │
                                           ┌──────────┼──────────┬──────────┐
                                           ▼          ▼          ▼          ▼
                                       postgres     redis      worker     embedder
                                       (pgvector)              (Celery    (semantic
                                                               + beat)    search)
```

| Service | What it does |
|---|---|
| `api` | Django on uvicorn (ASGI). Serves the API, the admin and the frontend build (whitenoise), keeps a stream open per tab with what changes (server-sent events, `GET /api/events/`), and a WebSocket per open note for live editing (`/api/live/notes/<id>`, see [live-editing.md](live-editing.md)). The only service with a published port. |
| `worker` | Celery with the beat scheduler embedded. Single instance. |
| `migrate` | Runs once per deploy: if migrations are pending it backs up the database first, then migrates and creates the admin user if missing. `api` and `worker` wait for it to succeed. |
| `postgres` | `pgvector/pgvector:0.8.1-pg17`, internal network only. |
| `redis` | Celery broker, the pub/sub that tells open tabs what changed (`api` and `worker` publish, `api` streams it), the one that keeps a note's live edits in step across `api` processes, and the shared count behind the [rate limits](#rate-limits). Internal network only. |
| `embedder` | Semantic search: turns text into vectors for `api` (search queries) and `worker` (items' text). The model (`paraphrase-multilingual-MiniLM-L12-v2`) is built into the image, so the running container never goes online. Takes ~600 MB of memory. Internal network only. If it is down, search goes by words alone. See [search.md](search.md). |
| `caddy` | Optional, with the `caddy` profile: HTTPS for the app and for blogs on their own domains. See [Caddy](#caddy). |
| `firewall` | Umbrel only, in `docker-compose.umbrel.yml`. See [Umbrel](#umbrel). |

Volumes: `postgres_data`, `redis_data`, `storage` (uploaded files, `/data/storage`), `backups`
(daily dumps, `/data/backups`), `exports` (users' full exports, `/data/exports`, kept for a day;
see [export.md](export.md)) and `caddy_data` (Caddy's certificates).

### Compose files

| File | What it is |
|---|---|
| `docker-compose.production.yml` | The stack, from the images published to GHCR on each release (`ghcr.io/thebrainbro/brainbro`, `brainbro-embedder`, `brainbro-caddy`, for amd64 and arm64). `BRAINBRO_VERSION` picks the version, the latest release by default. |
| `docker-compose.build.yml` | Builds those images from the checkout instead of pulling them. `make prod-up` uses it. |
| `docker-compose.umbrel.yml` | Adds the `firewall` service and the fixed subnet it opens. Only for Umbrel. |

The overrides go after the main file, as more `-f` options.

## Install

You need a machine with Docker and Docker Compose v2.

1. Get the compose file and the example settings, from a clone of this repository or from its
   files on GitHub: `docker-compose.production.yml` and `stack.env.example`.
2. Copy the settings and fill them in:

   ```bash
   cp stack.env.example stack.env
   ```

   | Variable | Value |
   |---|---|
   | `APP_HOSTNAMES` | The address you open BrainBro on, e.g. `brainbro.example.com`. |
   | `SECRET_KEY` | `openssl rand -base64 48` |
   | `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
   | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Your user, the admin. |

   Then `APP_HTTPS`, `APP_PROXY` and `APP_BIND`, as the way you reach it below says. Every
   setting is in [Settings](#settings).
3. Start it:

   ```bash
   docker compose --env-file stack.env -f docker-compose.production.yml up -d
   ```

   To build the images from a clone instead of pulling them: `make prod-up`, which adds
   `docker-compose.build.yml`.
4. Open BrainBro and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`. To add other people,
   create an invitation link in Settings → Invitations.

`api` is published on port `APP_PORT` (`8420`). How it gets HTTPS, and from where it can be
reached, is one of the three ways below.

## How it is reached

| | Cloudflare Tunnel | Caddy | Local network only |
|---|---|---|---|
| For | A server without open ports (at home, behind a router) | A server with a public IP and ports 80 and 443 open (a VPS) | Only devices on your network |
| HTTPS | Cloudflare | Caddy, with Let's Encrypt certificates | None |
| `APP_HTTPS` | `true` | `true` | `false` |
| `APP_PROXY` | `cloudflare` | `caddy` | `none` |
| `APP_BIND` | `127.0.0.1` when `cloudflared` runs on the same machine | `127.0.0.1` | Empty |

`APP_PROXY` tells BrainBro where each visitor's address comes from, for the
[rate limits](#rate-limits). With a proxy in front, keep the published port reachable only by
that proxy: anyone who reaches it directly can write any address in the proxy's header.

### Cloudflare Tunnel

The tunnel connects out from your server to Cloudflare, so no port has to be open. Your domain
has to be on Cloudflare. The steps follow
[Cloudflare's guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/):

1. In the Cloudflare dashboard, **Networking → Tunnels → Create a tunnel**. Give it a name and
   select **Create Tunnel**.
2. Pick the operating system of the machine that will run the tunnel, copy the command the
   dashboard shows and run it there. Once it shows as connected, select **Continue**.
3. On the tunnel's **Routes** tab, **Add route → Published application**: the subdomain and
   domain of `APP_HOSTNAMES`, and as **Service URL** the address of `api` as that machine sees
   it:
   - `cloudflared` installed on the BrainBro server itself: `http://localhost:8420`.
   - `cloudflared` in a Docker container, or on another machine: `localhost` there is not the
     server, so use the server's address on your network, e.g. `http://192.168.1.20:8420`.
4. In `stack.env`: `APP_HTTPS=true`, `APP_PROXY=cloudflare`, and `APP_BIND=127.0.0.1` if
   `cloudflared` runs on the server itself.

Cloudflare's Free and Pro plans refuse requests over 100 MB, which is why `IMPORT_MAX_SIZE`
defaults to 100 MB.

Blogs on their owners' own domains are added to the tunnel as more published applications: see
[blogs.md](blogs.md).

### Caddy

The stack has an optional `caddy` service that serves the app over HTTPS with certificates from
Let's Encrypt, and blogs on their own domains (see [blogs.md](blogs.md)). Caddy's
[requirements](https://caddyserver.com/docs/automatic-https) for getting certificates:

- Every name in `APP_HOSTNAMES` has an `A` (or `AAAA`) record pointing at the server.
- Ports 80 and 443 are open to the internet and free on the server.

Then, in `stack.env`: `APP_HTTPS=true`, `APP_PROXY=caddy` and `APP_BIND=127.0.0.1` (Caddy
reaches `api` over the stack's own network, so the published port only needs to answer on the
machine). With more than one hostname, separate them with a comma and a space
(`a.example.com, b.example.com`): without the space, Caddy doesn't start.

Start the stack with the `caddy` profile:

```bash
docker compose --env-file stack.env -f docker-compose.production.yml --profile caddy up -d
```

Certificates live in the `caddy_data` volume: keep it, or Caddy has to request them again.

### Local network only

Without TLS, for devices on your own network:

- `APP_HTTPS=false`, `APP_PROXY=none`, `APP_BIND` empty.
- `APP_HOSTNAMES`: the address you open it on, e.g. `192.168.1.20` or a local name.
- Open `http://192.168.1.20:8420`.

Passwords and sessions travel unencrypted, so keep it off the internet. Browsers reserve some
features for HTTPS: without it there is no installing the app, no share target and no voice
recording, and the Telegram bot needs an HTTPS address to receive messages on (an `https://`
[public address](#public-address) or `TELEGRAM_WEBHOOK_URL`).

With `APP_HTTPS=true`, opening the app over plain HTTP won't let you sign in, because the
session cookie is only sent over HTTPS. Responses served over HTTPS also carry an HSTS header,
so a hostname that has been opened over HTTPS keeps going to HTTPS for an hour, even after
setting `APP_HTTPS=false`.

## Settings

Everything in [`stack.env.example`](../stack.env.example). Only the first four are required;
the stack refuses to start without `SECRET_KEY`, `APP_HOSTNAMES` and `POSTGRES_PASSWORD`. It
also refuses the `CHANGE_ME` placeholder in `SECRET_KEY`, and in `ADMIN_PASSWORD` while the
admin user does not exist yet.

| Variable | Default | What it does |
|---|---|---|
| `APP_HOSTNAMES` | Required | The hostnames BrainBro answers to, comma-separated. The first one is the app's own address (the Telegram webhook, for one). Any IP address the server is opened on (`192.168.1.50`, a Tailscale `100.x.y.z`) gets the app too. Any other host gets a 400, unless it is a verified blog's domain. |
| `SECRET_KEY` | Required | Signs sessions. Changing it signs everyone out. |
| `POSTGRES_PASSWORD` | Required | The database password, for `postgres` and the app. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Empty | The admin user, created on a deploy if it does not exist yet. Changing them later does nothing: change the password in `/admin/` instead. |
| `ADMIN_EMAIL` | Empty | The admin user's email, only when it is created. |
| `BRAINBRO_VERSION` | `latest` | The version of the published images, e.g. `0.10.0`. Not used when building from source. |
| `APP_PORT` | `8420` | The host port `api` is published on. |
| `APP_BIND` | Empty, every interface | The address the port is published on. `127.0.0.1` keeps it on this machine, for a tunnel or proxy running on it. |
| `APP_HTTPS` | `true` | `false` only on a local network without TLS. Anything other than `false`, `0`, `no` or `off` keeps it on. Turns on secure cookies and HSTS. |
| `APP_PROXY` | `none` | What is in front of the app: `cloudflare`, `caddy`, or `none`. Anything else counts as `none`. See [Rate limits](#rate-limits). |
| `POSTGRES_DB` / `POSTGRES_USER` | `brain` | The database name and user. |
| `TIME_ZONE` | `UTC` | The server's time zone, for scheduled jobs such as the daily backup. |
| `BACKUP_RETENTION` | `14` | How many daily database dumps the `backups` volume keeps. See [backups.md](backups.md). |
| `UPLOAD_MAX_SIZE` | `52428800` (50 MB) | The largest file accepted by capture, in bytes. |
| `STORAGE_QUOTA` | Empty, no quota | The most each user may store, in MB (`10240` is 10 GB). See [Storage quota](#storage-quota). |
| `IMPORT_MAX_SIZE` | `104857600` (100 MB) | The largest zip accepted by Settings, Import (a BrainBro export or an Obsidian vault), in bytes. See [import.md](import.md). |
| `SOURCE_CODE_URL` | This repository | Linked from the About dialog. See [Source code link](#source-code-link). |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | Empty | The Telegram bot, off without them, unless an admin sets one up in Settings, Telegram, which wins over them. See [telegram.md](telegram.md). |
| `TELEGRAM_WEBHOOK_URL` | `https://<first APP_HOSTNAMES>/api/telegram/webhook/` with `APP_HTTPS=true`; otherwise the [public address](#public-address) when it is `https://`; otherwise empty | Where Telegram sends the bot's messages. Only needed when that address isn't the right one; Telegram only delivers to HTTPS. |
| `EMAIL_PROVIDER` | Empty, email off | Who sends the server's email (password resets, invitations): `mailgun`. Settings saved in Settings, Server, Email are used instead. See [Email](#email). |
| `EMAIL_FROM` | `BrainBro <noreply@<MAILGUN_DOMAIN>>` | Who the email comes from, e.g. `BrainBro <hello@example.com>`. |
| `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` | Empty | A Mailgun sending API key and the domain it sends from. |
| `MAILGUN_REGION` | `us` | `us` or `eu`: where the Mailgun domain was added. |
| `SITE_CNAME_TARGET` | Empty: the [public address](#public-address)'s host, or the host BrainBro is opened on | The host blogs on their own domains point their `CNAME` at. See [blogs.md](blogs.md). |
| `SITE_IPV4` | Empty | The server's public IPv4, shown as an `A` record for root domains. Leave it empty behind a tunnel. |
| `EMBED_HOSTNAME` | Empty, posts from X show as cards | The hostname posts from X play from, e.g. `embed.example.com`. See [Embed host](#embed-host). |

No request can be larger than the largest of `UPLOAD_MAX_SIZE` and `IMPORT_MAX_SIZE`, plus
1 MB for the rest of the form: anything bigger is refused with a 413 before it is read, so
nobody can fill the disk with one huge request.

### Embed host

A note can embed a post from X. X's embed runs X's own script, so BrainBro never runs it in
the app's pages or a blog's: it plays in a small page served from a hostname of its own,
`EMBED_HOSTNAME`. That page has no cookies and no access to the app, and it only answers with
embedded posts. Without `EMBED_HOSTNAME`, links to X show as a link or a card.

Use a hostname that is only for this, e.g. `embed.example.com`, never one of `APP_HOSTNAMES`
or a blog's domain. Then make it reach BrainBro like the app's address:

- **Cloudflare Tunnel**: another published application on the tunnel, with the same
  **Service URL** as the app.
- **Caddy**: an `A` (or `AAAA`) record pointing at the server. Caddy gets its certificate the
  first time it is visited, as for blogs.
- **Local network only**: a local name for the server, opened over HTTP like the app.

### Storage quota

With `STORAGE_QUOTA` set, each user can store that much at most: uploads and their
thumbnails, images in notes, link previews, profile, collection and blog images. Exports
and vault zips waiting to be imported don't count, so anyone can always export their data.
A file that doesn't fit in what is left is refused with a message saying so, wherever it
comes from (the app, Telegram, an AI assistant, an Obsidian import); nothing already stored
is touched. Each user sees what they use and what is left in Settings, Storage.

The admin can give one user another quota in `/admin/`, on their profile (`Storage quota`,
in MB). Empty there means the server's `STORAGE_QUOTA`.

### Email

BrainBro sends email for two things: a link to choose a new password when someone forgets
theirs, and invitation links, when the admin types the person's email. Without email, the
sign-in page doesn't offer a reset, the admin changes forgotten passwords in `/admin/`, and
invitation links are only copied and shared by hand.

To turn it on with [Mailgun](https://www.mailgun.com/):

1. Add a sending domain in Mailgun (a subdomain such as `mail.example.com` keeps your main
   domain's mail apart) and add the DNS records it asks for.
2. Create a sending API key for that domain.
3. In the app, open Settings, Server, Email: pick Mailgun, enter the key, the domain and its
   region, and save. **Send a test email** sends one to your own email (set it in Settings,
   Profile) and shows Mailgun's answer if it fails.

Or set it in the environment instead: `EMAIL_PROVIDER=mailgun`, `MAILGUN_API_KEY`,
`MAILGUN_DOMAIN`, and `MAILGUN_REGION=eu` if the domain is in Mailgun's EU region, then
redeploy. Settings saved in the app are used instead of the environment's until **Use the
environment variables instead** drops them. Saving with the key left empty keeps the key
in use, the environment's included.

A key saved in the app is stored encrypted with a key derived from `SECRET_KEY`, so a database
dump or backup doesn't carry it readable. Changing `SECRET_KEY` makes it unreadable: email goes
off until the key is entered again.

If a setting is missing, email stays off: Settings, Server, Email says so, and
`python3 manage.py check`, in the `api` container, says what is missing. Reset emails are sent
by the `worker`, so a failure to send one shows in its log. Invitation emails are sent right
away, and a failure shows next to the new link, which can still be shared by hand.

Each person adds the email reset links go to in Settings, Profile, or when they join with an
invitation (filled in with the address the invitation was sent to). It is optional, and two
accounts can't share one. A reset link works once, for an hour, and asking for one says the
same whether or not an account uses that email.

### Public address

The address people outside open BrainBro on, e.g. `https://brain.example.com`, set by the
admin in Settings, Server, General. Every address BrainBro sends or shows starts with
it: invitation links and their email, password reset emails, public note and profile pages
(their links and previews), what the AI assistant tools return, the MCP address in Settings,
AI assistants, and the address in Settings, Profile and the About dialog. Without one, they
start with the address BrainBro is opened on, which only works on that network when it is
local (`umbrel.local:8420`, `192.168.1.20`): Settings, Invitations warns about it.

- BrainBro answers on its host too, as if it were in `APP_HOSTNAMES`. Every other host it
  answered on still works.
- When it is `https://`, requests for its host trust the proxy's `X-Forwarded-Proto`, as
  `APP_HTTPS=true` does for every host. That is what lets a tunnel sign in and send forms to a
  server set up for plain HTTP, such as the Umbrel app.
- With a Telegram bot and no `TELEGRAM_WEBHOOK_URL`, an `https://` address is where Telegram
  sends the bot's messages; saving a new one points the bot there. Without one, Settings,
  Telegram tells admins the bot can't receive messages.
- Links already sent keep the address they were made with, and still open while BrainBro
  answers on it.
- It can't be a blog's domain or the embed host. Typing only the host (`brain.example.com`)
  saves it as `https://`.

OAuth discovery for MCP clients keeps the address each client connected on: the address the
client was given is the one it has to see in the answer.

### Source code link

The About dialog links to the code the server runs, taken from `SOURCE_CODE_URL`. BrainBro is
AGPL-3.0: if you run a modified version that other people use over the network, its section 13
asks you to offer them the source of your version. Set `SOURCE_CODE_URL` to where it can be
downloaded, for example your fork, and redeploy. No rebuild is needed.

## Rate limits

Counted per client address and per minute, in Redis, so every `api` process shares the count.
Over the limit, the answer is a 429 with `Retry-After`, for at most a minute.

| What | Limit | What counts |
|---|---|---|
| Sign-in, in the app and in `/admin/` | 5 | Failed attempts. Once reached, even the right password has to wait. |
| Invitation links | 20 | Every request |
| Asking for a password reset link | 5 | Every request |
| Password reset links | 20 | Every request |
| OAuth register | 20 | Every request |
| OAuth token | 20 | Failed requests |
| API and MCP tokens | 30 | Tokens that were never issued. A valid token always gets through, and an expired one doesn't count. |

If Redis doesn't answer, each `api` process counts on its own, in memory, and the `api` log
says so: the limits stay on, only looser (one count per process, 3 by default).

The client's address depends on `APP_PROXY`:

- `cloudflare` reads `CF-Connecting-IP`, `caddy` reads the last `X-Forwarded-For` value, and
  `none` uses the address of the connection.
- With `none` behind a proxy, every visitor looks like the proxy and they all share one limit,
  so a few wrong passwords from anyone block sign-in for everybody for a minute.
- With a proxy set, the header is only read on connections from this machine or a private
  network, where the proxy runs. Someone who reaches the published port straight from the
  internet is counted by their own address, whatever the header says. Still, keep the port
  reachable only by the proxy, for example with `APP_BIND=127.0.0.1` when the proxy runs on
  the same machine, or with a firewall: Docker can show IPv6 connections as coming from its
  own private network.

## What the server's admin can see

Each person's notes, links, files, boards, collections, history and blogs are theirs: the app
shows them to no one else, the admin included.

- `/admin/` holds only what running the server needs: users, invitations, the apps connected
  over OAuth, and personal API tokens (their name, owner, app and last use, never the key).
  There is no page for anyone's content.
- The logs carry ids, not content: a failed link preview logs the item's id, not its URL, and
  the `api` access log keeps each request's path but drops its query string, where searches
  and OAuth sign-in codes travel.

That doesn't cover whoever reaches the database or the disk: the `postgres_data`, `storage`,
`backups` and `exports` volumes hold everything as it is, unencrypted, and so does a
`manage.py shell` in a container. Anyone who runs the server for other people can read those,
so only invite people who trust whoever runs it.

## Upgrading

```bash
docker compose --env-file stack.env -f docker-compose.production.yml pull
docker compose --env-file stack.env -f docker-compose.production.yml up -d
```

Add `--profile caddy` to both if you use Caddy. With `BRAINBRO_VERSION` set, change it to the
new version first. Built from source: `git pull`, then `make prod-up`.

`migrate` runs on its own and backs up the database before any migration.

## Umbrel

On Umbrel, BrainBro runs as a Portainer stack built from this repository, usually behind a
[Cloudflare Tunnel](#cloudflare-tunnel).

### Install

Following [Portainer's guide](https://docs.portainer.io/user/docker/stacks/add): **Stacks → Add
stack**, give it a name, and pick **Git Repository**:

- Repository: `https://github.com/TheBrainBro/brainbro`
- Repository reference: `refs/heads/main`
- Compose path: `docker-compose.production.yml`
- Additional paths (**Add file**): `docker-compose.build.yml`, then `docker-compose.umbrel.yml`,
  in that order. Without `docker-compose.build.yml` the stack pulls the published images
  instead of building them. Without `docker-compose.umbrel.yml` its containers can't reach each
  other (see below).
- Environment variables: those in [Settings](#settings), one by one, or with **Load variables
  from .env file**.

Then **Deploy the stack**. The tunnel's **Service URL** is `http://<umbrel-ip>:8420`.

On the Umbrel app (from the App Store), environment variables can't be set and it runs with
`APP_HTTPS=false`. To reach it through a Cloudflare Tunnel, point the tunnel's published
application at `http://<umbrel-ip>:8420`, then set its address in Settings, Server, General
(see [Public address](#public-address)): BrainBro then answers on it, sign-in and forms work over
the tunnel, and links, MCP and the Telegram webhook use it. The Telegram bot is set up in
Settings, Telegram (see [telegram.md](telegram.md)).

### Updating

In the stack, **Pull and redeploy**, with **Re-pull image and redeploy** on, then **Update**
([Portainer's guide](https://docs.portainer.io/user/docker/stacks/edit)).

### Why `firewall`

On Umbrel, Portainer's Docker shares the host network namespace with umbrelOS's Docker.
umbrelOS's Docker sets the nftables `FORWARD` policy to drop, and Portainer's Docker writes its
accept rules with iptables-legacy, which that policy ignores. Without extra rules, containers
in a new stack can't reach each other or the internet (DNS resolves, but `postgres` times out).
Older stacks only work because of nftables rules left from before Portainer's Docker switched
to legacy, and those are gone after a host reboot.

`docker-compose.umbrel.yml` adds a `firewall` service on the host network with `NET_ADMIN`. It
adds `DOCKER-USER` accept rules for the stack's fixed subnet (`10.77.0.0/24`) and checks them
again every minute; `migrate` waits for it. On other hosts the chain may not exist: the service
logs a warning and the stack starts anyway.

### Why no bind mounts

Portainer's **Pull and redeploy** does not reliably put new repository files on disk.
Everything the images need is copied into them at build time.
