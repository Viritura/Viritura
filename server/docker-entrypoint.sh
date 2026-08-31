#!/usr/bin/env sh
set -eu

# Railway volumes are initially root-owned. Prepare only Viritura's persistent
# directories, then drop privileges before starting ASP.NET Core.
: "${APP_UID:?The .NET runtime image must define APP_UID}"

if [ "$(id -u)" = "$APP_UID" ]; then
  exec "$@"
fi
if [ "$(id -u)" != 0 ]; then
  echo "The API entrypoint must start as root or APP_UID." >&2
  exit 1
fi

install -d -o "$APP_UID" -g "$APP_UID" -m 0700 \
  /var/lib/viritura/data \
  /var/lib/viritura/data-protection-keys
chown -R "$APP_UID:$APP_UID" \
  /var/lib/viritura/data \
  /var/lib/viritura/data-protection-keys

exec gosu "$APP_UID:$APP_UID" "$@"