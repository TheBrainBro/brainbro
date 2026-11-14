<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-header-dark.png" />
  <img src="docs/assets/readme-header-light.png" alt="BrainBro" />
</picture>

# BrainBro

A self-hosted second brain: capture links, notes, images and files with zero friction, then organize them into boards (infinite canvas) and collections.

> **Drop it now, sort it later.** Everything lands in the inbox; organizing is a separate step.

## What it does

- **Capture anything:** paste or drop links, notes, images, files and voice recordings, from
  the browser, your phone's share sheet ([pwa.md](docs/pwa.md)) or a Telegram bot
  ([telegram.md](docs/telegram.md)). Links get their previews in the background.
- **Notes** in Markdown, linked to each other with `[[Title]]` ([wikilinks.md](docs/wikilinks.md)),
  edited live from several devices at once, with their version history.
- **Boards:** infinite canvases where items are laid out in space ([boards.md](docs/boards.md)).
  **Collections** that nest, and a **graph** of how everything ties together.
- **Search** by words and by meaning, with a model that runs on your server
  ([search.md](docs/search.md)).
- **AI assistants** (Claude, ChatGPT and others) read from and write to it through MCP
  ([mcp.md](docs/mcp.md)).
- **Publish** a note as a public page, or a collection as a blog on your own domain
  ([public-notes.md](docs/public-notes.md), [blogs.md](docs/blogs.md)).
- **Your data stays yours:** import an Obsidian vault, export everything as Markdown and files
  ([import.md](docs/import.md), [export.md](docs/export.md)).
- Several people on one server, each with their own space, by invitation.

Every page of the documentation is listed in [docs/](docs/README.md).

## Self-hosting

### Requirements

- A machine with Docker and Docker Compose v2. The images are built for Linux on amd64 and arm64.
- About 600 MB of memory for semantic search, on top of the app and its database.
- For HTTPS, either a domain on Cloudflare (Cloudflare Tunnel, no open ports) or a public IP
  with ports 80 and 443 open (Caddy). Without HTTPS it works on your local network only.

### Install

```bash
mkdir brainbro && cd brainbro
curl -fsSLO https://raw.githubusercontent.com/TheBrainBro/brainbro/main/docker-compose.production.yml
curl -fsSL https://raw.githubusercontent.com/TheBrainBro/brainbro/main/stack.env.example -o stack.env
```

Edit `stack.env`: at least `APP_HOSTNAMES`, `SECRET_KEY` (`openssl rand -base64 48`),
`POSTGRES_PASSWORD` (`openssl rand -base64 32`), `ADMIN_USERNAME` and `ADMIN_PASSWORD`, and
`APP_HTTPS`, `APP_PROXY` and `APP_BIND` for the way you reach it. Then:

```bash
docker compose --env-file stack.env -f docker-compose.production.yml up -d
```

[docs/deployment.md](docs/deployment.md) has the three ways to reach it (Cloudflare Tunnel,
Caddy, local network only), every setting, and Umbrel.

### First user

The first deploy creates the admin user from `ADMIN_USERNAME` and `ADMIN_PASSWORD`: sign in
with them. To add other people, create an invitation link in Settings → Invitations.

### Backups

The worker dumps the database every day at 04:00 and keeps the last 14 (`BACKUP_RETENTION`). They live on the same
disk, so copy them somewhere else, together with the uploaded files:
[docs/backups.md](docs/backups.md).

### Upgrading

```bash
docker compose --env-file stack.env -f docker-compose.production.yml pull
docker compose --env-file stack.env -f docker-compose.production.yml up -d
```

The database is backed up before any migration, and migrated on its own.

Roadmap and pending work: [epic #1](https://github.com/TheBrainBro/brainbro/issues/1).

## Development

### Stack

| Part | Technology |
|---|---|
| Backend | Django 6 + DRF, Celery + Redis |
| Database | Postgres 17 with pgvector |
| Frontend | Vite + React + TypeScript + Tailwind (React Flow for the canvas) |
| Auth | Django sessions |
| Deployment | Docker Compose, images on GHCR |

```
backend/    Django (config/, apps/)
frontend/   Vite + React
docker/     image entrypoint
scripts/    backup and restore
docs/       documentation (index in docs/README.md)
```

### Setup

Requirements: Python 3.12, Poetry 2, Node 24, Docker and libmagic (`brew install libmagic`; preinstalled on most Linux distros).

```bash
make install       # dependencies + pre-commit hooks
make dev           # Postgres + Redis in Docker, migrations, Django + Celery + Vite
make superuser     # create your user (in another terminal)
```

Open http://localhost:5173. Vite proxies `/api` and `/admin` to Django (:8000).

In development, Postgres and Redis use ports **5442** and **6389** to avoid clashing with other projects.

#### Trying the PWA on a phone

The service worker (install, share target, offline) only runs in the production build, and phones only allow it over HTTPS. Stop `make dev` first (two Celery workers would share the queue), then:

```bash
make preview                 # build the frontend, serve it from Django on :8000, with the worker
ngrok http 8000              # or: cloudflared tunnel --url http://localhost:8000
```

Open the tunnel's `https://` URL in Chrome (Android) or Safari (iOS), not in an in-app browser. `*.ngrok-free.app` and `*.trycloudflare.com` are allowed in the develop settings. Rebuild (`make frontend-build`) after frontend changes; the service worker picks the new build up on the next load.

```bash
make test          # pytest + vitest
make lint          # ruff + oxlint + tsc
make help          # everything else
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the issue workflow, pull request conventions,
development checks and Git flow.

External contributions need a signed [Contributor License Agreement](CLA.md). The CLA
Assistant bot asks for it on your first pull request; pull requests are not merged
without it.

Merging a `release/x.y.z` or `hotfix/x.y.z` PR into `main` tags `vx.y.z` and publishes
its GitHub release, with notes built from the issues in the PR's `Ref` line
(`.github/workflows/release.yml`). To redo one by hand: `scripts/release.sh <pr-number>`.


## License

The code is licensed under the [GNU AGPL v3](LICENSE) (`AGPL-3.0-only`). The BrainBro
name, logo and mascot are not covered by it: see [TRADEMARKS.md](TRADEMARKS.md) for what is
allowed. Files from other projects keep their own licenses, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
