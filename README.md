<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-header-dark.png" />
  <img src="docs/assets/readme-header-light.png" alt="BrainBro" />
</picture>

# BrainBro

A self-hosted second brain: capture links, notes, images and files with zero friction, then organize them into boards (infinite canvas) and collections.

> **Drop it now, sort it later.** Everything lands in the inbox; organizing is a separate step.

Roadmap and pending work: [epic #1](https://github.com/CarlosLugones/brain/issues/1).

## Stack

| Part | Technology |
|---|---|
| Backend | Django 6 + DRF, Celery + Redis |
| Database | Postgres 17 with pgvector |
| Frontend | Vite + React + TypeScript + Tailwind (React Flow for the canvas) |
| Auth | Django sessions |
| Deployment | Docker Compose on Umbrel (Portainer) + Cloudflare Tunnel |

```
backend/    Django (config/, apps/)
frontend/   Vite + React
docker/     image entrypoint
scripts/    backup and restore
docs/       documentation (deployment, etc.)
site/       landing page (static, see docs/landing.md)
```

## Development

Requirements: Python 3.12, Poetry 2 (with `poetry-plugin-export`), Node 24, Docker and libmagic (`brew install libmagic`; preinstalled on most Linux distros).

```bash
make install       # dependencies + pre-commit hooks
make dev           # Postgres + Redis in Docker, migrations, Django + Celery + Vite
make superuser     # create your user (in another terminal)
```

Open http://localhost:5173. Vite proxies `/api` and `/admin` to Django (:8000).

In development, Postgres and Redis use ports **5442** and **6389** to avoid clashing with other projects.

### Trying the PWA on a phone

The service worker (install, share target, offline) only runs in the production build, and phones only allow it over HTTPS. Stop `make dev` first (two Celery workers would share the queue), then:

```bash
make preview                 # build the frontend, serve it from Django on :8000, with the worker
ngrok http 8000              # or: cloudflared tunnel --url http://localhost:8000
```

Open the tunnel's `https://` URL in Chrome (Android) or Safari (iOS), not in an in-app browser. `*.ngrok-free.app` and `*.trycloudflare.com` are allowed in the develop settings. Rebuild (`make frontend-build`) after frontend changes; the service worker picks the new build up on the next load.

```bash
make test          # pytest + vitest
make lint          # ruff + oxlint + tsc
make exportdeps    # regenerate backend/requirements*.txt after changing dependencies
make help          # everything else
```

## Contributing

- [Conventional Commits](https://www.conventionalcommits.org/): `feat(backend): ...`, `fix(frontend): ...`, `chore(infra): ...`
- Git flow: `main` (releases), `develop` (integration), `feature/*`, `release/*`, `hotfix/*`.
- Merging a `release/x.y.z` or `hotfix/x.y.z` PR into `main` tags `vx.y.z` and publishes its GitHub release, with notes built from the issues in the PR's `Ref` line (`.github/workflows/release.yml`). To redo one by hand: `scripts/release.sh <pr-number>`.
- Issues, PRs, commits, code and docs in English.

## Production

See [docs/deployment.md](docs/deployment.md).
