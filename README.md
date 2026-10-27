# Brain

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
```

## Development

Requirements: Python 3.12, Poetry 2 (with `poetry-plugin-export`), Node 24, Docker.

```bash
make install       # dependencies + pre-commit hooks
make dev           # Postgres + Redis in Docker, migrations, Django + Celery + Vite
make superuser     # create your user (in another terminal)
```

Open http://localhost:5173. Vite proxies `/api` and `/admin` to Django (:8000).

In development, Postgres and Redis use ports **5442** and **6389** to avoid clashing with other projects.

```bash
make test          # pytest + vitest
make lint          # ruff + oxlint + tsc
make exportdeps    # regenerate backend/requirements*.txt after changing dependencies
make help          # everything else
```

## Contributing

- [Conventional Commits](https://www.conventionalcommits.org/): `feat(backend): ...`, `fix(frontend): ...`, `chore(infra): ...`
- Git flow: `main` (releases), `develop` (integration), `feature/*`, `release/*`, `hotfix/*`.
- Issues, PRs, commits, code and docs in English.

## Production

See [docs/deployment.md](docs/deployment.md).
