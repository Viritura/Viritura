#!/usr/bin/env bash
set -euo pipefail

# Run explicitly as root when reviewed API host configuration changes.
readonly bundle="${1:?usage: install-host-config.sh BUNDLE_DIR}"
readonly root=/opt/viritura-api
readonly sudoers="$bundle/deploy/api/viritura-api-deploy.sudoers"

[[ -f "$bundle/deploy/api/Dockerfile.runtime" \
  && -f "$bundle/deploy/api/compose.yaml" \
  && -f "$bundle/deploy/api/backup.sh" \
  && -f "$bundle/deploy/api/manage.sh" \
  && -f "$sudoers" \
  && -f "$bundle/server/docker-entrypoint.sh" ]] || {
  echo "API host configuration bundle is incomplete." >&2
  exit 1
}

visudo --check --file "$sudoers"
install -d -o root -g root -m 0755 "$root/config" "$root/source"
install -o root -g root -m 0644 "$bundle/deploy/api/Dockerfile.runtime" "$root/config/Dockerfile"
install -o root -g root -m 0644 "$bundle/deploy/api/compose.yaml" "$root/config/compose.yaml"
install -o root -g root -m 0755 "$bundle/server/docker-entrypoint.sh" "$root/config/docker-entrypoint.sh"
install -o root -g root -m 0755 "$bundle/deploy/api/backup.sh" "$root/config/backup.sh"
install -o root -g root -m 0755 "$bundle/deploy/api/manage.sh" /usr/local/sbin/viritura-api-manage
install -o root -g root -m 0440 "$sudoers" /etc/sudoers.d/viritura-api-deploy

echo "Installed Viritura API host configuration."