#!/usr/bin/env bash
set -euo pipefail

# Run once as root after the repository bundle has been uploaded.
readonly bundle="${1:?usage: bootstrap.sh BUNDLE_DIR}"
readonly user=viritura-deploy
readonly root=/var/www/viritura
readonly legacy_root=/var/www/peter/viritura

[[ -f "$bundle/deploy/static/manage.sh" ]] || { echo "Static deployment bundle is incomplete." >&2; exit 1; }
[[ -f "$bundle/deploy/nginx-viritura.com.conf" ]] || { echo "Website nginx configuration is missing." >&2; exit 1; }
[[ -f "$bundle/deploy/nginx-app.viritura.com.conf" ]] || { echo "Editor nginx configuration is missing." >&2; exit 1; }
id "$user" >/dev/null 2>&1 || { echo "Deployment user $user does not exist." >&2; exit 1; }
[[ -d "$legacy_root" ]] || { echo "Current static root $legacy_root does not exist." >&2; exit 1; }

install -d -o "$user" -g "$user" -m 0750 "/home/$user/upload-static"
install -d -o root -g root -m 0755 \
  "$root/website/releases" \
  "$root/editor/releases"

if [[ ! -L "$root/website/current" ]]; then
  readonly website_release="$root/website/releases/bootstrap-$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -o root -g root -m 0755 "$website_release"
  rsync --archive --delete --exclude app "$legacy_root/" "$website_release/"
  ln -s "$website_release" "$root/website/current"
fi

if [[ ! -L "$root/editor/current" ]]; then
  [[ -f "$legacy_root/app/index.html" ]] || { echo "Current editor build is missing." >&2; exit 1; }
  readonly editor_release="$root/editor/releases/bootstrap-$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -o root -g root -m 0755 "$editor_release"
  rsync --archive --delete "$legacy_root/app/" "$editor_release/"
  ln -s "$editor_release" "$root/editor/current"
fi

install -o root -g root -m 0755 "$bundle/deploy/static/manage.sh" /usr/local/sbin/viritura-static-manage

cat >/etc/sudoers.d/viritura-deploy <<'EOF'
viritura-deploy ALL=(root) NOPASSWD: /usr/local/sbin/viritura-api-manage deploy
viritura-deploy ALL=(root) NOPASSWD: /usr/local/sbin/viritura-api-manage status
viritura-deploy ALL=(root) NOPASSWD: /usr/local/sbin/viritura-api-manage logs
viritura-deploy ALL=(root) NOPASSWD: /usr/local/sbin/viritura-api-manage backup
viritura-deploy ALL=(root) NOPASSWD: /usr/local/sbin/viritura-static-manage website
viritura-deploy ALL=(root) NOPASSWD: /usr/local/sbin/viritura-static-manage editor
EOF
chmod 0440 /etc/sudoers.d/viritura-deploy
visudo --check --file /etc/sudoers.d/viritura-deploy

readonly nginx_backup="/etc/nginx/viritura-static-backup-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$nginx_backup"
cp -a /etc/nginx/sites-available/viritura.com "$nginx_backup/"
cp -a /etc/nginx/sites-available/app.viritura.com "$nginx_backup/"
install -o root -g root -m 0644 "$bundle/deploy/nginx-viritura.com.conf" /etc/nginx/sites-available/viritura.com
install -o root -g root -m 0644 "$bundle/deploy/nginx-app.viritura.com.conf" /etc/nginx/sites-available/app.viritura.com

if ! nginx -t; then
  cp -a "$nginx_backup/viritura.com" /etc/nginx/sites-available/viritura.com
  cp -a "$nginx_backup/app.viritura.com" /etc/nginx/sites-available/app.viritura.com
  echo "Nginx validation failed; restored the previous configurations." >&2
  exit 1
fi
systemctl reload nginx

echo "Provisioned independent Viritura website and editor deployments."