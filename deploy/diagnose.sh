#!/usr/bin/env bash
# G.SEO – server check before installing (read-only: it does not delete or change anything).
# Run as root in WHM → Terminal:  bash diagnose.sh
set -u

line() { printf '\n==== %s ====\n' "$1"; }

line "Sistema"
cat /etc/os-release 2>/dev/null | grep -E '^(PRETTY_NAME)=' ; nproc | sed 's/^/Núcleos: /'
uptime

line "Memoria (MB)"
free -m

line "Procesos que más memoria usan"
ps -eo pid,user,rss,comm --sort=-rss | head -n 15 | awk 'NR==1{print; next}{printf "%-8s %-12s %6d MB  %s\n",$1,$2,$3/1024,$4}'

line "Servicios que suelen sobrar en un VPS de sitios (revisa si los usas)"
for s in clamd clamav-daemon spamd spamassassin dovecot exim cpanel_php_fpm mailman pure-ftpd cphulkd; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^$s"; then printf '%-16s %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null)"; fi
done

line "Disco"
df -h / /home 2>/dev/null

line "Carpetas más grandes en /home (cuentas de cPanel)"
du -xsh /home/* 2>/dev/null | sort -rh | head -n 15

line "Respaldos de cPanel / WHM"
for d in /backup /home/backup /home/*/backup*; do [ -e "$d" ] && du -sh "$d" 2>/dev/null; done

line "Archivos de más de 500 MB (fuera de /proc)"
find / -xdev -type f -size +500M -printf '%s\t%p\n' 2>/dev/null | sort -rn | head -n 20 | awk -F'\t' '{printf "%6.1f GB  %s\n", $1/1073741824, $2}'

line "Logs grandes"
du -sh /var/log /usr/local/apache/logs /usr/local/cpanel/logs /var/cpanel/bandwidth 2>/dev/null
find /var/log /usr/local/apache/logs /usr/local/cpanel/logs -type f -size +100M -printf '%s\t%p\n' 2>/dev/null | sort -rn | head -n 10 | awk -F'\t' '{printf "%6.0f MB  %s\n", $1/1048576, $2}'

line "Caché de paquetes y papelera"
du -sh /var/cache/dnf /home/*/.trash 2>/dev/null | sort -rh | head

line "Listo"
echo "Mándale este resultado a Claude (no incluye contraseñas). Nada se borró."
