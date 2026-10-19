#!/usr/bin/env bash
# G.SEO – what the server has for hosting G.SEO in a cPanel account (read-only: changes nothing).
# Run as root in WHM → Terminal.
D=seo.glitchcreativo.com
line() { printf '\n==== %s ====\n' "$1"; }
line "Sistema"; grep PRETTY_NAME /etc/os-release; nproc | sed 's/^/Núcleos: /'; free -m | sed -n 1,3p; df -h / /home | sed 1d
line "Cuenta de cPanel de $D"; U=$(grep -E "^$D:" /etc/userdomains | awk '{print $2}'); echo "Usuario: ${U:-NO ENCONTRADO}"
[ -n "$U" ] && { grep -E '^(PLAN|MAXADDON|HASSHELL|FEATURELIST|IP)=' /var/cpanel/users/$U; getent passwd $U | cut -d: -f6,7; du -sh /home/$U 2>/dev/null; }
line "CloudLinux"; [ -e /etc/cloudlinux-release ] && cat /etc/cloudlinux-release || echo "No (AlmaLinux normal)"
line "cPanel"; /usr/local/cpanel/cpanel -V 2>/dev/null
line "Node.js de cPanel (ea-nodejs)"; rpm -qa | grep -E '^ea-nodejs|passenger' | sort; ls -d /opt/cpanel/ea-nodejs* 2>/dev/null; command -v node && node -v
line "Application Manager (Passenger)"; rpm -q ea-apache24-mod-passenger 2>/dev/null; grep -l -i "passengerapps" /var/cpanel/features/* 2>/dev/null | head -3
line "Redis"; rpm -qa | grep -i redis; command -v redis-server; systemctl is-active redis 2>/dev/null
line "Chromium / Chrome"; for b in chromium chromium-browser google-chrome; do command -v $b; done; rpm -q epel-release 2>/dev/null
line "Puertos en uso (para no chocar)"; ss -ltnp 2>/dev/null | awk 'NR>1{print $4}' | sed 's/.*://' | sort -n | uniq | tr '\n' ' '; echo
line "Listo"; echo "Nada se cambió. Copia todo el resultado y pégaselo a Claude (no trae contraseñas)."
