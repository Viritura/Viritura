#!/usr/bin/env bash
set -euo pipefail

# Installed root-owned as /usr/local/sbin/viritura-api-manage. This is the
# deploy account's only passwordless sudo entry; never execute release scripts.
readonly root=/opt/viritura-api
readonly upload=/home/viritura-deploy/upload
readonly compose="$root/config/compose.yaml"
readonly dockerfile="$root/config/Dockerfile"
# The image builds apps/server-ui from the pnpm workspace before it
# publishes the API, so the Docker build context is the whole repository, not
# just the server/ subtree.
readonly source="$root/source"
readonly lock=/run/lock/viritura-api-deploy.lock
readonly runtime_config=/etc/viritura/api.env

exec 9>"$lock"
flock -n 9 || { echo "Another Viritura API operation is running." >&2; exit 1; }

validate_config() {
  local file="$1"
  local required_key

  [[ -s "$file" ]] || { echo "Runtime configuration is empty." >&2; return 1; }
  (( $(stat -c '%s' "$file") <= 65536 )) || {
    echo "Runtime configuration exceeds the 64 KiB safety limit." >&2
    return 1
  }
  [[ "$(stat -c '%U:%G' "$file")" == "root:root" ]] || {
    echo "Runtime configuration must be owned by root:root." >&2
    return 1
  }
  [[ "$(stat -c '%a' "$file")" == "600" ]] || {
    echo "Runtime configuration must have mode 0600." >&2
    return 1
  }

  if grep -Ev '^[[:space:]]*(#.*|$|[A-Za-z_][A-Za-z0-9_]*=.*)$' "$file" >/dev/null; then
    echo "Runtime configuration contains an invalid dotenv line." >&2
    return 1
  fi
  if sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "$file" | sort | uniq -d | grep -q .; then
    echo "Runtime configuration contains a duplicate key." >&2
    return 1
  fi
  if grep -Eq '=REPLACE(_WITH_|_IN_)' "$file"; then
    echo "Runtime configuration still contains a placeholder value." >&2
    return 1
  fi

  for required_key in \
    ASPNETCORE_ENVIRONMENT \
    Database__Provider \
    ConnectionStrings__VirituraDb \
    DataProtection__KeysDirectory \
    Auth__WebsiteBaseUrl \
    Features__Authentication__EmailRegistrationMode \
    Email__Provider \
    Email__Resend__ApiKey \
    Email__Resend__From; do
    grep -Eq "^${required_key}=.+" "$file" || {
      echo "Runtime configuration is missing required key ${required_key}." >&2
      return 1
    }
  done

  grep -qx 'ASPNETCORE_ENVIRONMENT=Production' "$file" || {
    echo "ASPNETCORE_ENVIRONMENT must be Production." >&2
    return 1
  }
  grep -qx 'Email__Provider=Resend' "$file" || {
    echo "Email__Provider must be Resend in production." >&2
    return 1
  }
}

case "${1:-}" in
  deploy)
    [[ -d "$upload/server/Viritura.Api" ]] || {
      echo "Missing release content under $upload/server." >&2
      exit 1
    }
    [[ -f "$upload/package.json" && -f "$upload/pnpm-lock.yaml" && -f "$upload/pnpm-workspace.yaml" ]] || {
      echo "Missing pnpm workspace files required to build apps/server-ui." >&2
      exit 1
    }
    validate_config "$runtime_config"
    install -d -o root -g root -m 0755 "$source"
    rsync --archive --delete --safe-links \
      --exclude .git --exclude node_modules --exclude bin --exclude obj \
      --exclude dist --exclude target \
      --exclude '*.db' --exclude '*.db-shm' --exclude '*.db-wal' \
      "$upload/" "$source/"
    chown -R root:root "$source"
    find "$source" -type d -exec chmod 0755 {} +
    find "$source" -type f -exec chmod 0644 {} +
    docker build --file "$dockerfile" --tag viritura-api:latest "$source"
    docker compose --project-name viritura-api --file "$compose" up --detach --remove-orphans --wait
    ;;
  status)
    docker compose --project-name viritura-api --file "$compose" ps
    ;;
  logs)
    docker compose --project-name viritura-api --file "$compose" logs --no-color --tail 200 api
    ;;
  backup)
    "$root/config/backup.sh"
    ;;
  *)
    echo "Usage: viritura-api-manage {deploy|status|logs|backup}" >&2
    exit 2
    ;;
esac