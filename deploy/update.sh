#!/usr/bin/env bash
# G.SEO – update to the latest version from GitHub (run as root: gseo-update).
# Backs up the database first, then downloads, builds, migrates and restarts. Your settings and data stay.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecútalo como root."; exit 1; }
. /etc/gseo.conf
APP=$BASE/app
ENVF=$BASE/gseo.env
BRANCH="${GSEO_BRANCH:-main}"
as_user() { sudo -u "$CPUSER" -H bash -c "$1"; }
as_user_env() { sudo -u "$CPUSER" -H bash -c "set -a; . '$ENVF'; set +a; unset NODE_ENV; cd '$APP'; $1"; }

echo "▶ Respaldo antes de actualizar"
as_user /usr/local/bin/gseo-backup

echo "▶ Descargando la última versión"
as_user "git -C '$APP' fetch --quiet origin '$BRANCH'"
BEFORE=$(as_user "git -C '$APP' rev-parse --short HEAD")
as_user "git -C '$APP' reset --quiet --hard 'origin/$BRANCH'"
AFTER=$(as_user "git -C '$APP' rev-parse --short HEAD")
[ "$BEFORE" = "$AFTER" ] && { echo "Ya tienes la última versión ($AFTER)."; exit 0; }
echo "$BEFORE → $AFTER"

echo "▶ Compilando (unos minutos)"
as_user_env "pnpm install --frozen-lockfile --prod=false --reporter=silent"
as_user_env "NODE_ENV=production pnpm build >/dev/null"
echo "▶ Base de datos"
as_user_env "pnpm --filter @glitch/db exec prisma migrate deploy"
install -m 755 "$APP/deploy/backup.sh" /usr/local/bin/gseo-backup
install -m 750 "$APP/deploy/update.sh" /usr/local/bin/gseo-update

echo "▶ Reiniciando"
systemctl restart gseo-api gseo-worker gseo-web
sleep 5
for s in gseo-api gseo-worker gseo-web; do printf '%-12s %s\n' "$s" "$(systemctl is-active $s)"; done
echo "✔ Actualizado a $AFTER"
