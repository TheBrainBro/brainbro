#!/usr/bin/env bash
# Archive uploaded files (the storage volume) to a tarball on the host.
#   scripts/backup-storage.sh [output-dir]   (default: ./backups)
# Restore: docker compose ... run --rm --no-deps -T api tar xzf - -C /data < file.tar.gz
set -euo pipefail
source "$(dirname "$0")/_compose.sh"

out_dir=${1:-backups}
mkdir -p "$out_dir"
target="$out_dir/brain-storage-$(date -u +%Y%m%d-%H%M%S).tar.gz"

compose run --rm --no-deps -T api tar czf - -C /data storage > "$target.partial"
mv "$target.partial" "$target"
echo "Storage backup written to $target"
