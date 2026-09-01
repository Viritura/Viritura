#!/usr/bin/env bash
set -euo pipefail

# Run once as root. Runtime configuration is installed separately from releases.
readonly public_key_file="${1:?usage: bootstrap-deploy-user.sh PUBLIC_KEY_FILE BUNDLE_DIR}"
readonly bundle="${2:?usage: bootstrap-deploy-user.sh PUBLIC_KEY_FILE BUNDLE_DIR}"
readonly user=viritura-deploy
readonly root=/opt/viritura-api

[[ -f "$public_key_file" ]] || { echo "Public key not found." >&2; exit 1; }
[[ -f "$bundle/deploy/api/install-host-config.sh" ]] || {
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
touch "/home/$user/.ssh/authorized_keys"
public_key="$(cat "$public_key_file")"
grep -Fqx -- "restrict $public_key" "/home/$user/.ssh/authorized_keys" \
  || printf 'restrict %s\n' "$public_key" >>"/home/$user/.ssh/authorized_keys"
chown "$user:$user" "/home/$user/.ssh/authorized_keys"
chmod 0600 "/home/$user/.ssh/authorized_keys"

install -d -o root -g root -m 0755 "$root/config" "$root/source"
install -d -o 1654 -g 1654 -m 0700 "$root/data" "$root/data-protection-keys"
install -d -o root -g root -m 0700 /etc/viritura
bash "$bundle/deploy/api/install-host-config.sh" "$bundle"

cat >/etc/cron.d/viritura-api-backup <<'EOF'
10 11 * * * root /usr/local/sbin/viritura-api-manage backup >>/var/log/viritura-api-backup.log 2>&1
EOF
chmod 0644 /etc/cron.d/viritura-api-backup

echo "Provisioned $user with constrained Viritura API management access."