#!/usr/bin/env bash
set -euo pipefail

# Run explicitly as root when reviewed static host configuration changes.
readonly bundle="${1:?usage: install-host-config.sh BUNDLE_DIR}"
readonly sudoers="$bundle/deploy/static/viritura-static-deploy.sudoers"

[[ -f "$bundle/deploy/static/manage.sh" && -f "$sudoers" ]] || {
  echo "Static host configuration bundle is incomplete." >&2
  exit 1
}

visudo --check --file "$sudoers"
install -o root -g root -m 0755 "$bundle/deploy/static/manage.sh" /usr/local/sbin/viritura-static-manage
install -o root -g root -m 0440 "$sudoers" /etc/sudoers.d/viritura-static-deploy

echo "Installed Viritura static host configuration."