# Poetry must use backend/.venv, not an inherited virtualenv from the shell.
unexport VIRTUAL_ENV

POETRY = cd backend && poetry
MANAGE = $(POETRY) run python manage.py
PROD = docker compose --env-file stack.env -f docker-compose.production.yml

.PHONY: help
help: ## Show this help
	@echo "Usage: make [target]"
	@awk '/^[a-zA-Z0-9_-]+:.*?##/ { \
		match($$0, /## (.*)/); target = $$1; sub(/:/, "", target); \
		printf "  \033[36m%-18s\033[0m %s\n", target, substr($$0, RSTART + 3, RLENGTH); \
	}' $(MAKEFILE_LIST)

.PHONY: install
install: ## Install backend and frontend dependencies and git hooks
	$(POETRY) install
	cd frontend && npm install
	$(POETRY) run pre-commit install

.PHONY: exportdeps
exportdeps: ## Export Poetry dependencies to backend/requirements*.txt
	$(POETRY) export -f requirements.txt --output requirements.txt --without-hashes
	$(POETRY) export -f requirements.txt --output requirements-dev.txt --without-hashes --only=dev

.PHONY: services
services: ## Start Postgres, Redis and the embedder for development
	docker compose up -d --wait

.PHONY: services-down
services-down: ## Stop development Postgres, Redis and the embedder
	docker compose down

.PHONY: down
# By project name, so the production stack stops even without stack.env.
down: ## Stop every Docker service of this project (dev and local production stack)
	docker compose -p brain-dev down --remove-orphans
	docker compose -p brain down --remove-orphans

.PHONY: dev
dev: services migrate ## Run Django, the Celery worker and Vite together
	$(MAKE) -j3 backend worker frontend

.PHONY: backend
backend: ## Run the Django dev server on :8000
	$(MANAGE) runserver

.PHONY: worker
# Threads, not prefork: on macOS billiard spawns pool processes, which breaks
# Celery's task tracer. Tasks here are I/O-bound anyway.
worker: ## Run the Celery worker (with beat) for development
	$(POETRY) run celery -A config worker --beat --pool threads --loglevel info

.PHONY: frontend
frontend: ## Run the Vite dev server on :5173
	cd frontend && npm run dev

.PHONY: migrate
migrate: ## Apply database migrations
	$(MANAGE) migrate

.PHONY: makemigrations
makemigrations: ## Create new migrations
	$(MANAGE) makemigrations

.PHONY: migrations
migrations: makemigrations ## Alias of makemigrations

.PHONY: superuser
superuser: ## Create a development superuser
	$(MANAGE) createsuperuser

.PHONY: shell
shell: ## Django shell
	$(MANAGE) shell

.PHONY: test
test: services ## Run backend and frontend tests
	$(POETRY) run pytest
	cd frontend && npm test

.PHONY: tests
tests: test ## Alias of test

.PHONY: lint
lint: ## Lint and format check backend and frontend
	$(POETRY) run ruff check .
	$(POETRY) run ruff format --check .
	cd frontend && npm run lint && npm run typecheck

.PHONY: format
format: ## Auto-format the backend
	$(POETRY) run ruff format .
	$(POETRY) run ruff check --fix .

.PHONY: preview
preview: services migrate frontend-build ## Serve the built frontend from Django on :8000 (PWA, phone via a tunnel), with the worker
	$(MAKE) -j2 backend worker

.PHONY: frontend-build
frontend-build: ## Build the frontend into frontend/dist
	cd frontend && npm run build

.PHONY: prod-up
prod-up: ## Build and start the production stack (needs stack.env)
	$(PROD) up -d --build

.PHONY: prod-logs
prod-logs: ## Follow production logs
	$(PROD) logs -f --tail 100

.PHONY: backup
backup: ## Back up the production database and files to ./backups
	scripts/backup-db.sh
	scripts/backup-storage.sh
