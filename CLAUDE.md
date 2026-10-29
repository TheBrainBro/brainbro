# Brain

Self-hosted second brain (Umbrel). Product principle: **drop it now, sort it later**: capturing has zero friction and everything lands in the inbox; organizing (boards, collections) is a separate step. Views (canvas, folders, graph…) are different lenses over the same data.

Roadmap: epic #1 on GitHub (`gh issue view 1`), sub-issues labeled `phase-0`…`phase-4`.

## Structure

- `backend/`: Django 6 + DRF. `config/` (per-environment settings in `config/settings/{base,develop,testing,production}.py`, selected by `ENVIRONMENT`), `apps/<app>/`.
- `frontend/`: Vite + React + TS + Tailwind v4 + TanStack Query + React Router. API client in `src/lib/api.ts` (session + CSRF).
- `docker/entrypoint.sh`: one image for `api`, `worker` and `migrate`.
- `docs/deployment.md`: deployment and backups.

## Conventions

- Every user content model inherits from `apps.core.models.OwnedModel` (UUID pk, timestamps, `owner`). Views always filter by `request.user`.
- Notes are Markdown stored in the database. Board layouts are versioned JSON.
- Environment variables via `config.env.get_env_variable`.
- Auth: Django sessions; the API requires authentication by default (DRF `IsAuthenticated`).
- Slow or network work (previews, thumbnails) goes to Celery, never in the request.
- Tests: pytest in `apps/<app>/tests/`, vitest next to components (`*.test.tsx`).
- **Language:** everything in the repo and on GitHub (code, UI, docs, commits, issues, PRs, comments) is in English. Only chat with the user is in Spanish.

## Dependencies

- Python: Poetry is the source of truth (`backend/pyproject.toml` + `poetry.lock`). After changing dependencies run `make exportdeps` to regenerate `backend/requirements.txt` and `backend/requirements-dev.txt`; the Docker image installs from `requirements.txt` and CI fails if they are out of sync.
- The Makefile does `unexport VIRTUAL_ENV` because the user's shell exports a global pyenv one. Outside make, use `env -u VIRTUAL_ENV poetry ...`.

## Commands

`make dev`, `make test` (alias `tests`), `make lint`, `make format`, `make makemigrations` (alias `migrations`), `make exportdeps` (see `make help`). Dev Postgres is on port **5442**, Redis on **6389**.

## Git workflow

- Git flow: `main` (releases), `develop` (integration), `feature/<issue>-<slug>`, `release/x.y.z`, `hotfix/*`.
- Conventional Commits, atomic and small: `type(scope): summary` with scopes `backend`, `frontend`, `infra`, `docs`.
- Claude commits, pushes and opens PRs in this repo itself (the user's global hook that blocks this is scoped to exclude this folder). Group files into small commits, one issue per commit where possible, referencing it as `(#N)`.
- **No AI attribution anywhere:** no `Co-Authored-By`, no "Generated with", no signatures in commits, PRs, issues or comments. Everything is authored by the user.
- PRs target `develop`; `main` only receives releases (Portainer deploys from `main`).
