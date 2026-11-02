#!/usr/bin/env bash
# Dump the production database to a file on the host.
#   scripts/backup-db.sh [output-dir]   (default: ./backups)
set -euo pipefail
source "$(dirname "$0")/_compose.sh"

out_dir=${1:-backups}
mkdir -p "$out_dir"
target="$out_dir/brainbro-db-$(date -u +%Y%m%d-%H%M%S).dump"

compose exec -T postgres sh -c 'pg_dump --format=custom -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$target.partial"
mv "$target.partial" "$target"
echo "Database backup written to $target"
