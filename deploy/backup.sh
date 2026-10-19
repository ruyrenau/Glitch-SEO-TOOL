#!/usr/bin/env bash
# G.SEO – consistent copy of the SQLite database (safe while the app is running), compressed, last 7 kept.
# Runs daily from /etc/cron.d/gseo-backup as the cPanel account, and before every update.
set -euo pipefail
. /etc/gseo.conf
DATA=$BASE/data
DB=$DATA/gseo.db
OUT=$DATA/backups
KEEP=${GSEO_BACKUP_KEEP:-7}
[ -f "$DB" ] || { echo "No hay base de datos en $DB"; exit 0; }
mkdir -p "$OUT"
f="$OUT/gseo-$(date +%Y%m%d-%H%M%S).db"
sqlite3 "$DB" ".backup '$f'"
sqlite3 "$f" "PRAGMA integrity_check;" | grep -q '^ok$' || { echo "El respaldo no pasó la verificación"; rm -f "$f"; exit 1; }
gzip -9 "$f"
ls -1t "$OUT"/gseo-*.db.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "Respaldo: $f.gz ($(du -h "$f.gz" | cut -f1))"
