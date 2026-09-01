#!/usr/bin/env bash
set -euo pipefail

# Installed root-owned as /usr/local/sbin/viritura-api-manage. This is the
# deploy account's only passwordless sudo entry; never execute release scripts.
readonly root=/opt/viritura-api
readonly uploaded_archive=/home/viritura-deploy/api-publish.tar.gz
readonly archive="$root/api-publish.incoming.tar.gz"
readonly compose="$root/config/compose.yaml"
readonly dockerfile="$root/config/Dockerfile"
readonly entrypoint="$root/config/docker-entrypoint.sh"
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

validate_archive() {
  local entry
  local listing

  (( $(stat -c '%s' "$archive") <= 536870912 )) || {
    echo "API publish archive exceeds the 512 MiB safety limit." >&2
    return 1
  }

  while IFS= read -r entry; do
    case "$entry" in
      /* | ../* | */../* | */..) echo "Unsafe archive path: $entry" >&2; return 1 ;;
    esac
  done < <(tar -tzf "$archive")

  while IFS= read -r listing; do
    case "${listing:0:1}" in
      - | d) ;;
      *) echo "API archives may contain only regular files and directories." >&2; return 1 ;;
    esac
  done < <(tar -tvzf "$archive")
}

case "${1:-}" in
  deploy)
    [[ -s "$uploaded_archive" ]] || { echo "Missing API publish archive." >&2; exit 1; }
    rm -f "$archive"
    mv "$uploaded_archive" "$archive"
    chown root:root "$archive"
    chmod 0400 "$archive"
    validate_archive
    validate_config "$runtime_config"
    rm -rf "$source.next"
    install -d -o root -g root -m 0755 "$source.next"
    tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$source.next"
    [[ -f "$source.next/Viritura.Api.dll" \
      && -f "$source.next/Viritura.Api.deps.json" \
      && -f "$source.next/Viritura.Api.runtimeconfig.json" ]] || {
      echo "API publish archive is incomplete." >&2
      exit 1
    }
    install -o root -g root -m 0755 "$entrypoint" "$source.next/docker-entrypoint.sh"
    chown -R root:root "$source.next"
    find "$source.next" -type d -exec chmod 0755 {} +
    find "$source.next" -type f ! -name docker-entrypoint.sh -exec chmod 0644 {} +
    rm -rf "$source"
    mv "$source.next" "$source"
    rm -f "$archive"
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