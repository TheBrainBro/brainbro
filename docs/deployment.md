# Deployment on Umbrel (Portainer) + Cloudflare Tunnel

## Architecture

```
Internet ── Cloudflare Tunnel ──► api :8420 (gunicorn + Django + static frontend)
                                    │
                         ┌──────────┼──────────┐
                         ▼          ▼          ▼
                     postgres     redis      worker (Celery + beat)
                     (pgvector)              daily backups, previews…
```

| Service | What it does |
|---|---|
| `api` | Django on gunicorn. Serves the API, the admin and the frontend build (whitenoise). The only service with a published port. |
| `worker` | Celery with the beat scheduler embedded. Single instance. |
| `migrate` | Runs once per deploy: if migrations are pending it backs up the database first, then migrates and creates the admin user if missing. `api` and `worker` wait for it to succeed. |
| `postgres` | `pgvector/pgvector:0.8.1-pg17`, internal network only. |
| `redis` | Celery broker, internal network only. |

Volumes: `postgres_data`, `redis_data`, `storage` (uploaded files, `/data/storage`) and `backups` (daily dumps, `/data/backups`).

**Why no nginx/Caddy:** Cloudflare terminates TLS and the tunnel points straight at `api`. Django serves static files with whitenoise, and uploaded files will go through authenticated views.

**Why everything uses `build: context:` and no bind mounts:** Portainer's "Pull and redeploy" does not reliably materialize new repo files on disk (seen in simmers-app). Everything the image needs is copied at build time.

## 1. Prepare the environment

In Portainer: **Stacks → Add stack → Repository**:

- Repository URL: `https://github.com/CarlosLugones/brain`
- Reference: `refs/heads/main`
- Compose path: `docker-compose.production.yml`
- Environment variables: those in [`stack.env.example`](../stack.env.example)

The required ones:

| Variable | Value |
|---|---|
| `APP_HOSTNAMES` | The tunnel's public hostname, e.g. `brain.yourdomain.com` |
| `SECRET_KEY` | `openssl rand -base64 48` |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Your user. Only created if it does not exist. |

From a terminal on the server instead:

```bash
cp stack.env.example stack.env   # then edit it
make prod-up
```

## 2. Cloudflare Tunnel

In Zero Trust → Networks → Tunnels, add a *public hostname*:

- Hostname: the same as `APP_HOSTNAMES`
- Service: `http://<umbrel-ip>:8420` (or your `APP_PORT`)

## 3. Updating

In Portainer, **Pull and redeploy** with "Re-pull image and redeploy" checked. `migrate` runs automatically and backs up the database before any migration.

## Backups

- **Automatic:** the worker runs a daily `pg_dump` at 04:00 (`TIME_ZONE`) into the `backups` volume and keeps the latest `BACKUP_RETENTION` (14 by default).
- **Manual, to a host folder** (from the stack folder):

  ```bash
  scripts/backup-db.sh [folder]        # database dump
  scripts/backup-storage.sh [folder]   # tar.gz of uploaded files
  ```

- **Restore the database** (stops `api` and `worker` meanwhile):

  ```bash
  scripts/restore-db.sh backups/brain-db-YYYYMMDD-HHMMSS.dump
  ```

For a stack with another name or env file: `COMPOSE="docker compose -p <name> --env-file <env> -f docker-compose.production.yml" scripts/...`

> ⚠️ Automatic dumps live on the same disk as the database. They protect against app bugs and bad migrations, not against losing the disk. Copy `backups/` (or the volume) somewhere else periodically.
