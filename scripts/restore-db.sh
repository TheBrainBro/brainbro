#!/usr/bin/env bash
# Restore a pg_dump custom-format file into the production database.
# Replaces the current data. api and worker are stopped during the restore.
#   scripts/restore-db.sh <file.dump>
set -euo pipefail
source "$(dirname "$0")/_compose.sh"

dump=${1:?Usage: scripts/restore-db.sh <file.dump>}
[ -f "$dump" ] || { echo "File not found: $dump" >&2; exit 1; }

read -r -p "This replaces the current database with $dump. Continue? [y/N] " answer
[ "$answer" = "y" ] || { echo "Aborted."; exit 1; }

compose stop api worker
compose exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$dump"
compose up -d api worker
echo "Database restored from $dump"
