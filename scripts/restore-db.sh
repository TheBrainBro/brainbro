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
restore_status=0
compose exec -T postgres sh -c \
  'pg_restore --single-transaction --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$dump" || restore_status=$?
if [ "$restore_status" -ne 0 ]; then
  echo "Database restore failed. Restarting api and worker." >&2
fi
compose start api worker
[ "$restore_status" -eq 0 ] || exit "$restore_status"
echo "Database restored from $dump"
