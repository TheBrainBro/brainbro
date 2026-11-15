# Contributing to BrainBro

Thanks for helping. Issues, pull requests, commits, code and documentation are written in
English. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bugs, small fixes and docs:** open a pull request directly.
- **New features or larger changes:** open an issue first, or comment on an existing one,
  so we can agree on the approach before you spend time on it.
- **Security vulnerabilities:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Contributor License Agreement

Every author of the commits in a pull request signs the [Contributor License Agreement](CLA.md)
once. The CLA Assistant bot comments on your first pull request with a link to sign it with
your GitHub account. Pull requests are not merged until it is signed.

## Development setup

Requirements: Python 3.12, Poetry 2, Node 24, Docker with Compose v2, and libmagic
(`brew install libmagic` on macOS; preinstalled on most Linux distributions).

Fork the repository and clone your fork (it opens on `develop`):

```bash
git clone git@github.com:<you>/brainbro.git
cd brainbro
make install       # backend and frontend dependencies, and the pre-commit hooks
make dev           # Postgres, Redis and the embedder in Docker, migrations, Django + Celery + Vite
make superuser     # create your user (in another terminal)
```

Open http://localhost:5173. Vite proxies `/api` and `/admin` to Django on port 8000.

- The services in Docker use ports **5442** (Postgres), **6389** (Redis) and **8100**
  (embedder), to avoid clashing with other projects. The first `make dev` builds the
  embedder, which downloads its model (about 250 MB).
- The defaults match `docker-compose.yml`, so no configuration is needed. To change
  something, copy `backend/.env.example` to `backend/.env`.
- `make help` lists every target. `make down` stops every container of the project.

```
backend/    Django 6 + DRF, Celery (config/, apps/<app>/)
frontend/   Vite + React + TypeScript + Tailwind (React Flow for the canvas)
docker/     image entrypoint, embedder and Caddy images
scripts/    backup, restore and release
docs/       documentation (index in docs/README.md)
```

### Trying the PWA on a phone

The service worker (install, share target, offline) only runs in the production build, and
phones only allow it over HTTPS. Stop `make dev` first (two Celery workers would share the
queue), then:

```bash
make preview                 # build the frontend, serve it from Django on :8000, with the worker
ngrok http 8000              # or: cloudflared tunnel --url http://localhost:8000
```

Open the tunnel's `https://` URL in Chrome (Android) or Safari (iOS), not in an in-app
browser. `*.ngrok-free.app` and `*.trycloudflare.com` are allowed in the develop settings.
Rebuild (`make frontend-build`) after frontend changes; the service worker picks the new
build up on the next load.

## Tests and checks

```bash
make test          # pytest + vitest (starts the Docker services if needed)
make lint          # ruff check, ruff format --check, oxlint, tsc
make format        # format the backend with ruff and apply its fixes
make migrations    # after changing a model
```

While iterating, run the narrower ones: `cd backend && poetry run pytest apps/<app>` or
`cd frontend && npm test -- src/<path>.test.tsx`.

- Backend tests live in `backend/apps/<app>/tests/` (pytest), frontend tests next to the
  component they test (`*.test.tsx`, vitest).
- The pre-commit hooks installed by `make install` run ruff, oxlint, gitleaks and basic
  file checks on the staged files.

Every pull request runs these workflows:

- **CI:** the same lint and tests, a check that no migration is missing, the frontend build,
  the Docker images and the production compose files.
- **gitleaks:** secrets in the history.
- **pip-audit:** known vulnerabilities in the Python dependencies. One that does not affect
  the project goes in `.github/pip-audit/ignore.txt`, with the reason.
- **Semgrep:** security rules. A finding that does not apply is ignored on its line, naming
  the rule and the reason, as in `# nosemgrep: avoid-mark-safe -- sanitized by nh3`
  (see `.github/semgrep/scan.sh`). To run it locally:
  `git submodule update --init .github/semgrep/rules`, then `.github/semgrep/scan.sh`.
- **CodeQL:** code scanning.

## Code conventions

- Every model for user content inherits from `apps.core.models.OwnedModel`, and every view
  filters by `request.user`.
- Slow or network work (previews, thumbnails) runs in Celery, never in the request.
- Settings are read with `config.env.get_env_variable`.
- Text users see in the product is in English; translations are described in
  [docs/translations.md](docs/translations.md).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), small and atomic, with the
scope `backend`, `frontend`, `infra` or `docs`, and the issue number at the end:

```
feat(backend): import Obsidian attachments (#123)
fix(frontend): keep the board zoom after reload (#123)
```

## Branches and pull requests

Git flow: `develop` is the integration branch and `main` only receives releases.

1. Branch from the latest `develop`: `feature/<issue>-<slug>` (for example
   `feature/123-obsidian-attachments`).
2. Open the pull request against `develop` and fill in the template.
3. Reference the issue as `Refs #123`, not `Closes` or `Fixes`. Issues are closed by hand
   once the change is released.

Before asking for review, `make test` and `make lint` pass and you have tried the change in
the app.
