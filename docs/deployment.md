# Deployment

BrainBro runs as a Docker Compose stack on a server of yours. This page covers installing it,
the three ways to reach it (a Cloudflare Tunnel, Caddy, or only your local network), every
setting, upgrading, and Umbrel. Backups are in [backups.md](backups.md), and installing the app
on a phone in [pwa.md](pwa.md).

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
recording, and the Telegram bot needs `TELEGRAM_WEBHOOK_URL` pointing at an HTTPS address.

With `APP_HTTPS=true`, opening the app over plain HTTP won't let you sign in, because the
session cookie is only sent over HTTPS. Responses served over HTTPS also carry an HSTS header,
so a hostname that has been opened over HTTPS keeps going to HTTPS for an hour, even after
setting `APP_HTTPS=false`.

## Settings

Everything in [`stack.env.example`](../stack.env.example). Only the first four are required;
the stack refuses to start without `SECRET_KEY`, `APP_HOSTNAMES` and `POSTGRES_PASSWORD`.

| Variable | Default | What it does |
|---|---|---|
| `APP_HOSTNAMES` | Required | The hostnames BrainBro answers to, comma-separated. The first one is the app's own address (the Telegram webhook, for one). Any other host gets a 400, unless it is a verified blog's domain. |
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
| `IMPORT_MAX_SIZE` | `104857600` (100 MB) | The largest Obsidian vault zip accepted by "Import from Obsidian", in bytes. See [import.md](import.md). |
| `SOURCE_CODE_URL` | This repository | Linked from the About dialog. See [Source code link](#source-code-link). |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | Empty | The Telegram bot, off without them. See [telegram.md](telegram.md). |
| `TELEGRAM_WEBHOOK_URL` | `https://<first APP_HOSTNAMES>/api/telegram/webhook/` with `APP_HTTPS=true`, otherwise empty | Where Telegram sends the bot's messages. Only needed when that address isn't the right one; Telegram only delivers to HTTPS. |
| `SITE_CNAME_TARGET` | Empty, the host BrainBro is opened on | The host blogs on their own domains point their `CNAME` at. See [blogs.md](blogs.md). |
| `SITE_IPV4` | Empty | The server's public IPv4, shown as an `A` record for root domains. Leave it empty behind a tunnel. |

No request can be larger than the largest of `UPLOAD_MAX_SIZE` and `IMPORT_MAX_SIZE`, plus
1 MB for the rest of the form: anything bigger is refused with a 413 before it is read, so
nobody can fill the disk with one huge request.

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
| OAuth register | 20 | Every request |
| OAuth token | 20 | Failed requests |
| API and MCP tokens | 30 | Tokens that were never issued. A valid token always gets through, and an expired one doesn't count. |

If Redis doesn't answer, nothing is limited and the `api` log says so.

The client's address depends on `APP_PROXY`:

- `cloudflare` reads `CF-Connecting-IP`, `caddy` reads the last `X-Forwarded-For` value, and
  `none` uses the address of the connection.
- With `none` behind a proxy, every visitor looks like the proxy and they all share one limit,
  so a few wrong passwords from anyone block sign-in for everybody for a minute.
- With a proxy set, anyone who reaches the published port directly can write any address in
  that header and escape the limits. Keep the port reachable only by the proxy, for example
  with `APP_BIND=127.0.0.1` when the proxy runs on the same machine, or with a firewall.

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
