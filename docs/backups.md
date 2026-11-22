# Backups

These restore the app. To take your data somewhere else, use **Export everything** in the
account menu instead ([export.md](export.md)).

## Automatic

The worker runs a daily `pg_dump` at 04:00 (`TIME_ZONE`) into the `backups` volume
(`/data/backups`) and keeps the latest `BACKUP_RETENTION` (14 by default). `migrate` also takes
one before applying any migration.

To copy one out of the volume:

```bash
docker compose --env-file stack.env -f docker-compose.production.yml exec worker ls /data/backups
docker compose --env-file stack.env -f docker-compose.production.yml cp worker:/data/backups/<file>.dump backups/
```

> ⚠️ Automatic dumps live on the same disk as the database. They protect against app bugs and
> bad migrations, not against losing the disk. Copy them somewhere else periodically.

## Manual, to a host folder

The scripts are in this repository's `scripts/` folder. Run them from a clone, with your
`stack.env` at its root:

```bash
scripts/backup-db.sh [folder]        # database dump
scripts/backup-storage.sh [folder]   # tar.gz of uploaded files
```

The folder defaults to `backups/`.

## Restore the database

Replaces the current database, and stops `api` and `worker` meanwhile:

```bash
scripts/restore-db.sh backups/brainbro-db-YYYYMMDD-HHMMSS.dump
```

It takes either kind of dump, automatic or manual. The restore runs in one transaction.
If PostgreSQL rejects part of the dump, it rolls back the changes. The script restarts
`api` and `worker` after either outcome and reports a failed restore with a nonzero exit status.

## Other stacks

For a stack with another name, env file or overrides, set `COMPOSE`:

```bash
COMPOSE="docker compose -p <name> --env-file <env> -f docker-compose.production.yml" scripts/backup-db.sh
```
