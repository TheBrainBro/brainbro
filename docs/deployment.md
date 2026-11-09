# Deployment on Umbrel (Portainer) + Cloudflare Tunnel

## Architecture

```
Internet ── Cloudflare Tunnel ──► api :8420 (uvicorn + Django + static frontend)
                                    │
                         ┌──────────┼──────────┬──────────┐
                         ▼          ▼          ▼          ▼
                     postgres     redis      worker     embedder
                     (pgvector)              (Celery    (semantic
                                             + beat)    search)
```

| Service | What it does |
|---|---|
| `api` | Django on uvicorn (ASGI). Serves the API, the admin and the frontend build (whitenoise), keeps a stream open per tab with what changes (server-sent events, `GET /api/events/`), and a WebSocket per open note for live editing (`/api/live/notes/<id>`, see [live-editing.md](live-editing.md)). Cloudflare Tunnel passes WebSockets through as is. The only service with a published port. |
| `worker` | Celery with the beat scheduler embedded. Single instance. |
| `migrate` | Runs once per deploy: if migrations are pending it backs up the database first, then migrates and creates the admin user if missing. `api` and `worker` wait for it to succeed. |
| `postgres` | `pgvector/pgvector:0.8.1-pg17`, internal network only. |
| `redis` | Celery broker, the pub/sub that tells open tabs what changed (`api` and `worker` publish, `api` streams it), and the one that keeps a note's live edits in step across `api` processes. Internal network only. |
| `embedder` | Semantic search: turns text into vectors for `api` (search queries) and `worker` (items' text). The model (`paraphrase-multilingual-MiniLM-L12-v2`) is downloaded when the image is built, so the running container never goes online. Takes ~600 MB of memory. Internal network only. If it is down, search goes by words alone. See [search.md](search.md). |
| `firewall` | Umbrel workaround, host network with `NET_ADMIN`. Adds `DOCKER-USER` accept rules for the stack's subnet (`10.77.0.0/24`) and re-checks them every minute. `migrate` waits for it. |

**Why `firewall`:** on Umbrel, Portainer's Docker shares the host network namespace with umbrelOS's Docker. umbrelOS's Docker sets the nftables `FORWARD` policy to drop, and Portainer's Docker writes its accept rules with iptables-legacy, which that policy ignores. Without the extra rules, containers in a new stack can't reach each other or the internet (DNS resolves, but `postgres` times out). Older stacks only work because of nftables rules left from before Portainer's Docker switched to legacy, and those are gone after a host reboot. On other hosts the chain may not exist: the service logs a warning and the stack starts anyway.

Volumes: `postgres_data`, `redis_data`, `storage` (uploaded files, `/data/storage`), `backups` (daily dumps, `/data/backups`) and `exports` (users' full exports, `/data/exports`, kept for a day; see [export.md](export.md)).

**Why no nginx/Caddy:** Cloudflare terminates TLS and the tunnel points straight at `api`. Django serves static files with whitenoise, and uploaded files will go through authenticated views.

**Why everything uses `build: context:` and no bind mounts:** Portainer's "Pull and redeploy" does not reliably materialize new repo files on disk (seen in simmers-app). Everything the image needs is copied at build time.

## 1. Prepare the environment

In Portainer: **Stacks → Add stack → Repository**:

- Repository URL: `https://github.com/TheBrainBro/brainbro`
- Reference: `refs/heads/main`
- Compose path: `docker-compose.production.yml`
- Environment variables: those in [`stack.env.example`](../stack.env.example)

The required ones:

| Variable | Value |
|---|---|
| `APP_HOSTNAMES` | The tunnel's public hostname, e.g. `brainbro.yourdomain.com` |
| `SECRET_KEY` | `openssl rand -base64 48` |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Your user, the admin. Only created if it does not exist. To add other people, create an invitation link in Settings → Invitations. |

How it is reached:

| Variable | Default | Value |
|---|---|---|
| `APP_BIND` | Empty, every interface | The address `api` is published on. `127.0.0.1` keeps the port on this machine, for a tunnel or proxy running on it. |
| `APP_HTTPS` | `true` | `false` only on a local network without TLS. |

With `APP_HTTPS=false`, list the address you open it on in `APP_HOSTNAMES` (e.g. `192.168.1.20`) and use `http://192.168.1.20:8420`. Passwords and sessions travel unencrypted, so keep it off the internet. Browsers reserve some features for HTTPS: without it there is no installing the app, no share target and no voice recording, and the Telegram bot needs `TELEGRAM_WEBHOOK_URL` pointing at an HTTPS address. With `APP_HTTPS=true`, opening the app over plain HTTP won't let you sign in, because the session cookie is only sent over HTTPS. Responses served over HTTPS also carry an HSTS header, so a hostname that has been opened over HTTPS keeps going to HTTPS for an hour, even after setting `APP_HTTPS=false`.

From a terminal on the server instead:

```bash
cp stack.env.example stack.env   # then edit it
make prod-up
```

## 2. Cloudflare Tunnel

In Zero Trust → Networks → Tunnels, add a *public hostname*:

- Hostname: the same as `APP_HOSTNAMES`
- Service: `http://<umbrel-ip>:8420` (or your `APP_PORT`)

Blogs on their owners' own domains are added to the tunnel the same way, one public hostname
each: see [blogs.md](blogs.md).

## 3. Updating

In Portainer, **Pull and redeploy** with "Re-pull image and redeploy" checked. `migrate` runs automatically and backs up the database before any migration.

## Install on a phone (PWA)

BrainBro is an installable web app. It needs HTTPS, which the Cloudflare Tunnel already gives it (on a plain `http://<umbrel-ip>` address there is no service worker, so no install and no share target).

- **Android (Chrome):** open the hostname, sign in, then *Install app* from the menu. BrainBro then shows up in the share sheet of every app: text, links, photos and files go straight to the inbox.
- **iOS (Safari):** *Share → Add to Home Screen*. iOS has no Web Share Target, so for photos and files use the **+** tab (the quick capture view). For links and text from other apps, make a Shortcut that shows in the share sheet, takes *URLs and Text*, runs *URL Encode* on the input and then *Open URL* with `https://<hostname>/share?text=<URL Encoded Text>`. BrainBro asks for a tap before saving. The Shortcut opens Safari, which on iOS doesn't share the installed app's sign-in, so sign in once in Safari too.

How it is served:

| Path | Served by | Notes |
|---|---|---|
| `/sw.js` | Django (`apps.core.views.pwa_file`) | From the frontend build, `Cache-Control: no-cache`. At the root so its scope is the whole app. |
| `/manifest.webmanifest` | Django (same view) | `no-cache` as well. |
| `POST /share` | The service worker | Android's share target. Stores the share in IndexedDB and opens the inbox, where the app sends it through the capture pipeline. If it ever reaches Django (no service worker yet), Django only redirects to `/share?lost=1`; it never creates items. |
| `/static/…` | whitenoise | The build. The service worker precaches the shell and caches other hashed assets once loaded. |

The service worker never touches `/api/`, `/admin/` or `/media/`: sessions, CSRF and uploaded files always come from the server. Shares made offline or signed out stay on the phone and are sent the next time BrainBro is open, signed in and online.

Cloudflare respects the `no-cache` header, so a deploy reaches installed apps on their next load; don't add a cache rule that overrides it for `/sw.js`. If you ever put Cloudflare Access in front of BrainBro, the manifest is fetched without cookies: add `crossorigin="use-credentials"` to its `<link>` in `frontend/index.html` or bypass Access for `/manifest.webmanifest`.

## Backups

These restore the app. To take your data somewhere else, use **Export everything** in the account menu instead ([export.md](export.md)).

- **Automatic:** the worker runs a daily `pg_dump` at 04:00 (`TIME_ZONE`) into the `backups` volume and keeps the latest `BACKUP_RETENTION` (14 by default).
- **Manual, to a host folder** (from the stack folder):

  ```bash
  scripts/backup-db.sh [folder]        # database dump
  scripts/backup-storage.sh [folder]   # tar.gz of uploaded files
  ```

- **Restore the database** (stops `api` and `worker` meanwhile):

  ```bash
  scripts/restore-db.sh backups/brainbro-db-YYYYMMDD-HHMMSS.dump
  ```

For a stack with another name or env file: `COMPOSE="docker compose -p <name> --env-file <env> -f docker-compose.production.yml" scripts/...`

> ⚠️ Automatic dumps live on the same disk as the database. They protect against app bugs and bad migrations, not against losing the disk. Copy `backups/` (or the volume) somewhere else periodically.
