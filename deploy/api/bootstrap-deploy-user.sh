#!/usr/bin/env bash
set -euo pipefail

# Run once as root. The bundle must contain server/Dockerfile and deploy/api.
readonly public_key_file="${1:?usage: bootstrap-deploy-user.sh PUBLIC_KEY_FILE BUNDLE_DIR}"
readonly bundle="${2:?usage: bootstrap-deploy-user.sh PUBLIC_KEY_FILE BUNDLE_DIR}"
readonly user=viritura-deploy
readonly root=/opt/viritura-api

[[ -f "$public_key_file" ]] || { echo "Public key not found." >&2; exit 1; }
[[ -f "$bundle/server/Dockerfile" && -f "$bundle/deploy/api/compose.yaml" ]] || {
  echo "Deployment bundle is incomplete." >&2
  exit 1
}

if ! id "$user" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --user-group "$user"
fi
# Ubuntu's sshd rejects public-key login for a password-locked account. Assign
# an unknown random password hash; global password authentication remains off.
if passwd -S "$user" | grep -q ' L '; then
  usermod --password "$(openssl passwd -6 "$(openssl rand -hex 32)")" "$user"
fi

install -d -o "$user" -g "$user" -m 0700 "/home/$user/.ssh"
{
  printf 'restrict '
  cat "$public_key_file"
} >"/home/$user/.ssh/authorized_keys"
chown "$user:$user" "/home/$user/.ssh/authorized_keys"
chmod 0600 "/home/$user/.ssh/authorized_keys"
install -d -o "$user" -g "$user" -m 0750 "/home/$user/upload"

install -d -o root -g root -m 0755 "$root/config" "$root/source"
install -d -o 1654 -g 1654 -m 0700 "$root/data" "$root/data-protection-keys"
install -d -o root -g root -m 0700 /etc/viritura
install -o root -g root -m 0644 "$bundle/server/Dockerfile" "$root/config/Dockerfile"
install -o root -g root -m 0644 "$bundle/deploy/api/compose.yaml" "$root/config/compose.yaml"
install -o root -g root -m 0755 "$bundle/deploy/api/backup.sh" "$root/config/backup.sh"
install -o root -g root -m 0755 "$bundle/deploy/api/manage.sh" /usr/local/sbin/viritura-api-manage

cat >/etc/sudoers.d/viritura-deploy <<'EOF'
viritura-deploy ALL=(root) NOPASSWD: /usr/local/sbin/viritura-api-manage deploy
viritura-deploy ALL=(root) NOPASSWD: /usr/local/sbin/viritura-api-manage status
viritura-deploy ALL=(root) NOPASSWD: /usr/local/sbin/viritura-api-manage logs
viritura-deploy ALL=(root) NOPASSWD: /usr/local/sbin/viritura-api-manage backup
EOF
chmod 0440 /etc/sudoers.d/viritura-deploy
visudo --check --file /etc/sudoers.d/viritura-deploy

cat >/etc/cron.d/viritura-api-backup <<'EOF'
10 11 * * * root /usr/local/sbin/viritura-api-manage backup >>/var/log/viritura-api-backup.log 2>&1
EOF
chmod 0644 /etc/cron.d/viritura-api-backup

echo "Provisioned $user with constrained Viritura API management access."