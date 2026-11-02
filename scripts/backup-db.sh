#!/usr/bin/env bash
# Daily database backup (cron): a gzipped pg_dump of the running stack, keeping the
# newest $KEEP files in $BACKUP_DIR. Restore: see "Kopie zapasowe" in README.md.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/warden-backups}"
KEEP="${KEEP:-14}"
cd "$(dirname "$0")/.."

mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/warden-$(date +%Y%m%d-%H%M%S).sql.gz"
partial="$target.partial"

docker compose exec -T database sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > "$partial"
# A dump cut short (e.g. the database restarting) must not replace a good one.
gzip -t "$partial"
zcat "$partial" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || { echo "Incomplete dump: $partial" >&2; exit 1; }
mv "$partial" "$target"

ls -1t "$BACKUP_DIR"/warden-*.sql.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --
echo "$(date -Is) backup ok: $target ($(du -h "$target" | cut -f1)), $(ls -1 "$BACKUP_DIR"/warden-*.sql.gz | wc -l) kept"
