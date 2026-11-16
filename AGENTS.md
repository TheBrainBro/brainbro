# BrainBro for coding agents

Self-hosted second brain. Product principle: **drop it now, sort it later**: capturing has
zero friction and everything lands in the inbox; organizing (boards, collections) is a
separate step. Views (canvas, folders, graph) are different lenses over the same data.

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, tests and checks, code
conventions, commits, branches and pull requests. This file only adds what an agent needs
on top of it.

## Structure

- `backend/`: Django 6 + DRF. `config/` holds the settings per environment
  (`config/settings/{base,develop,testing,production}.py`, picked by `ENVIRONMENT`), and
  each app lives in `apps/<app>/`.
- `frontend/`: Vite + React + TypeScript + Tailwind v4 + TanStack Query + React Router.
  API client in `src/lib/api.ts` (session cookie + CSRF).
- `docker/entrypoint.sh`: one image for the `api`, `worker` and `migrate` services.
- `docs/`: user and technical docs, listed in `docs/README.md`.

## Conventions not covered in CONTRIBUTING.md

- Models get a UUID primary key and timestamps from `apps.core.models.OwnedModel`.
- Notes are Markdown stored in the database. Board layouts are JSON with a
  `schema_version`.
- Auth uses Django sessions (plus personal API tokens); the API requires authentication
  by default (DRF `IsAuthenticated`).
- Everything in the repository and on GitHub is in English: code, UI text, docs, commits,
  issues, pull requests and comments.
- Python dependencies: Poetry is the source of truth (`backend/pyproject.toml` +
  `poetry.lock`). The Docker image exports the requirements at build time; no exported
  file is committed. The Makefile unsets `VIRTUAL_ENV` so Poetry always uses the project's
  environment; outside make, run `env -u VIRTUAL_ENV poetry ...` if your shell sets it.

## Working in this repository

- Before editing, check `git status` and keep every existing local change. Never stage
  unrelated files.
- Do not merge pull requests, push to `develop` or `main`, or make releases unless asked.
