#!/usr/bin/env bash
# G.SEO – install inside a cPanel account on a WHM VPS (AlmaLinux / Rocky 9), for personal use.
#
#   bash install.sh seo.glitchcreativo.com ruyrenau
#
#   seo.glitchcreativo.com : the subdomain already created in WHM, with its SSL (AutoSSL)
#   ruyrenau               : the cPanel account that owns it
#
# Everything lives in that account (/home/USER/gseo) and runs as that user, not as root:
#   app/       the code (from GitHub)          data/      database, uploads, backups
#   gseo.env   settings and secrets (only the account can read it)
# Root is only used to install system packages (Node.js 22, Chromium), create the 3 services
# and tell Apache to pass https://DOMAIN to G.SEO. The existing Redis is used as is (its
# settings are not changed). Other accounts, sites, email and DNS are not touched.
# It can be run again safely: settings and data are kept.
set -euo pipefail

DOMAIN="${1:-}"
CPUSER="${2:-}"
REPO="${GSEO_REPO:-https://github.com/ruyrenau/Glitch-SEO-TOOL.git}"
BRANCH="${GSEO_BRANCH:-master}"
ADMIN_USER="${GSEO_ADMIN:-ruyrenau}"

say() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Ejecútalo como root (WHM → Terminal)."
[ -n "$DOMAIN" ] && [ -n "$CPUSER" ] || die "Uso: bash install.sh seo.tudominio.com usuario_cpanel"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "Dominio no válido: $DOMAIN"
grep -qE "^$DOMAIN: $CPUSER\$" /etc/userdomains || die "$DOMAIN no pertenece a la cuenta de cPanel '$CPUSER'."
grep -qiE 'almalinux|rocky|rhel' /etc/os-release || die "Este script es para AlmaLinux/Rocky 9."
systemctl is-active --quiet redis || die "Redis no está activo (systemctl status redis)."

HOMEDIR=$(getent passwd "$CPUSER" | cut -d: -f6)
BASE=$HOMEDIR/gseo
APP=$BASE/app
DATA=$BASE/data
ENVF=$BASE/gseo.env
UPATH=/usr/local/bin:/usr/bin:/bin
as_user() { sudo -u "$CPUSER" -H env PATH="$UPATH" bash -c "$1"; }
# Build-time commands read the settings but must not run with NODE_ENV=production (dev tools are needed to compile).
as_user_env() { sudo -u "$CPUSER" -H env PATH="$UPATH" bash -c "set -a; . '$ENVF'; set +a; unset NODE_ENV; cd '$APP'; $1"; }

say "1/7 Paquetes del sistema: Node.js 22, Chromium, SQLite, fuentes"
dnf -y module reset nodejs >/dev/null 2>&1 || true
dnf -y module enable nodejs:22 >/dev/null
dnf -y install nodejs npm git sqlite chromium google-noto-sans-fonts google-noto-emoji-color-fonts >/dev/null
npm install -g --silent pnpm@12.9.1 >/dev/null
echo "Node $(node -v) · pnpm $(pnpm -v)"
CHROME=$(command -v chromium-browser || command -v chromium || true)
[ -n "$CHROME" ] || die "No se encontró Chromium después de instalarlo."

say "2/7 Carpetas en $BASE"
as_user "mkdir -p '$DATA/uploads' '$DATA/backups' && chmod 700 '$BASE' '$DATA'"

say "3/7 Código de G.SEO desde GitHub"
if [ -d "$APP/.git" ]; then
  as_user "git -C '$APP' fetch --quiet origin '$BRANCH' && git -C '$APP' reset --quiet --hard 'origin/$BRANCH'"
else
  as_user "git clone --quiet --branch '$BRANCH' '$REPO' '$APP'"
fi
as_user "git -C '$APP' log --oneline -1"

say "4/7 Configuración ($ENVF)"
if [ ! -f "$ENVF" ]; then
  rnd() { openssl rand -hex 32; }
  cat > "$ENVF" <<EOF
# G.SEO – production settings. Private: only the account $CPUSER can read this file.
NODE_ENV=production
DEMO_MODE=false
HOST=127.0.0.1
PORT=4000
TRUST_PROXY=1
WEB_ORIGIN=https://$DOMAIN
API_PUBLIC_URL=https://$DOMAIN
NEXT_PUBLIC_API_URL=https://$DOMAIN
COOKIE_SECURE=true
DATABASE_URL=file:$DATA/gseo.db
# Database 5 of the server's Redis, with its own prefix: it does not mix with anything else using Redis.
REDIS_URL=redis://127.0.0.1:6379/5
QUEUE_PREFIX=gseo
EMBEDDED_WORKER=false
UPLOAD_DIR=$DATA/uploads
CHROME_PATH=$CHROME
CRAWL_MAX_RPS=2
CRAWL_HARD_MAX_URLS=10000
CRAWL_DETAIL_KEEP=3
CREDENTIALS_KEY=$(rnd)
SALT_SECRET=$(rnd)
SEED_ADMIN_USERNAME=$ADMIN_USER
SEED_ADMIN_NAME=$ADMIN_USER
# --- Fill in, then run as root: systemctl restart gseo-api gseo-worker -------------
# Google (Search Console + Analytics). In Google Cloud → your OAuth client, add the redirect URI:
#   https://$DOMAIN/api/v1/gsc/oauth/callback
GSC_CLIENT_ID=
GSC_CLIENT_SECRET=
PSI_API_KEY=
# Email for invitations and password reset: smtps://user:password@mail.server:465
SMTP_URL=
MAIL_FROM="G.SEO <no-reply@$DOMAIN>"
EOF
  chown "$CPUSER:$CPUSER" "$ENVF"
  echo "Creado. Las claves secretas se generaron solas en el servidor."
else
  echo "Ya existía: se conserva tal cual (tus claves no cambian)."
fi
chmod 600 "$ENVF"
# Fix files written by the first version of this script (unquoted value with < >).
sed -i -E 's/^MAIL_FROM=([^"].*<.*>)$/MAIL_FROM="\1"/' "$ENVF"
sudo -u "$CPUSER" bash -c "set -a; . '$ENVF'" || die "$ENVF tiene un error de formato."

say "5/7 Dependencias, compilación y base de datos (5–15 minutos)"
as_user_env "pnpm install --frozen-lockfile --prod=false --reporter=silent"
as_user_env "pnpm --filter @glitch/db exec prisma generate >/dev/null"
as_user_env "NODE_ENV=production pnpm build >/dev/null"
as_user_env "pnpm --filter @glitch/db exec prisma migrate deploy"
SEED_OUT=$(as_user_env "pnpm --silent db:seed" 2>&1 | tail -n 3 || true)
as_user "git -C '$APP' rev-parse --short HEAD > '$BASE/.built-commit'"

say "6/7 Servicios (arrancan solos al reiniciar el servidor), con límites para no afectar tus sitios"
NODE=$(command -v node)
unit() { # name, description, workdir, command, memory, cpu
  cat > "/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=$2
After=network.target redis.service
Wants=redis.service

[Service]
User=$CPUSER
Group=$CPUSER
WorkingDirectory=$3
EnvironmentFile=$ENVF
ExecStart=$4
Restart=always
RestartSec=5
Nice=10
MemoryHigh=$5
MemoryMax=$6
CPUQuota=$7
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
}
unit gseo-api "G.SEO API" "$APP" "$NODE apps/api/dist/index.js" 400M 550M 100%
unit gseo-worker "G.SEO worker (crawls, imports, Chromium)" "$APP" "$NODE apps/worker/dist/index.js" 800M 1000M 120%
unit gseo-web "G.SEO dashboard" "$APP/apps/web" "$NODE $APP/apps/web/node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1" 300M 400M 60%
systemctl daemon-reload
systemctl enable gseo-api gseo-worker gseo-web >/dev/null 2>&1
systemctl restart gseo-api gseo-worker gseo-web
cat > /etc/gseo.conf <<EOF
CPUSER=$CPUSER
BASE=$BASE
EOF

say "7/7 Apache (cPanel) → G.SEO, respaldo diario y comando de actualización"
for kind in ssl std; do
  d="/etc/apache2/conf.d/userdata/$kind/2_4/$CPUSER/$DOMAIN"
  mkdir -p "$d"
  if [ "$kind" = ssl ]; then
    cat > "$d/gseo.conf" <<'EOF'
# G.SEO: everything under this domain goes to the local services.
ProxyPreserveHost On
ProxyRequests Off
RequestHeader set X-Forwarded-Proto "https"
ProxyTimeout 300
ProxyPass /.well-known/acme-challenge/ !
ProxyPass /.well-known/pki-validation/ !
ProxyPass /api/ http://127.0.0.1:4000/api/
ProxyPassReverse /api/ http://127.0.0.1:4000/api/
ProxyPass /health http://127.0.0.1:4000/health
ProxyPass /docs http://127.0.0.1:4000/docs
ProxyPassReverse /docs http://127.0.0.1:4000/docs
ProxyPass / http://127.0.0.1:3000/
ProxyPassReverse / http://127.0.0.1:3000/
Header always set Strict-Transport-Security "max-age=31536000"
Header always set X-Content-Type-Options "nosniff"
Header always set Referrer-Policy "strict-origin-when-cross-origin"
EOF
  else
    cat > "$d/gseo.conf" <<'EOF'
# G.SEO: plain HTTP goes to HTTPS (except the AutoSSL check, so the certificate keeps renewing).
RewriteEngine On
RewriteCond %{REQUEST_URI} !^/\.well-known/
RewriteRule ^/(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]
EOF
  fi
done
/scripts/rebuildhttpdconf >/dev/null
/scripts/restartsrv_httpd >/dev/null

install -m 755 "$APP/deploy/backup.sh" /usr/local/bin/gseo-backup
install -m 750 "$APP/deploy/update.sh" /usr/local/bin/gseo-update
echo "15 3 * * * $CPUSER /usr/local/bin/gseo-backup >/dev/null 2>&1" > /etc/cron.d/gseo-backup

sleep 8
say "Comprobación"
for s in redis gseo-api gseo-worker gseo-web; do printf '%-12s %s\n' "$s" "$(systemctl is-active $s)"; done
curl -fsS -o /dev/null -w "API: HTTP %{http_code}\n" http://127.0.0.1:4000/health || echo "API: todavía arrancando (revisa: journalctl -u gseo-api -n 50)"
curl -fsS -o /dev/null -w "Web: HTTP %{http_code}\n" http://127.0.0.1:3000/ || echo "Web: todavía arrancando (revisa: journalctl -u gseo-web -n 50)"
curl -fsS -o /dev/null -w "Desde internet (https://$DOMAIN): HTTP %{http_code}\n" "https://$DOMAIN/health" || echo "Desde internet: aún no responde (revisa el SSL en WHM → Manage AutoSSL)"

cat <<EOF

✔ G.SEO instalado en $BASE
  Abre: https://$DOMAIN
  $SEED_OUT
  (Si dice "Temporary password", entra con "$ADMIN_USER" y esa contraseña: te pedirá cambiarla.)

  Siguientes pasos:
  1. Agrega tus claves en $ENVF (Google, PageSpeed, correo) y ejecuta: systemctl restart gseo-api gseo-worker
  2. En Google Cloud → tu cliente OAuth, agrega la URI de redirección: https://$DOMAIN/api/v1/gsc/oauth/callback
  Actualizar G.SEO más adelante (como root): gseo-update
  Respaldos diarios en: $DATA/backups
EOF
