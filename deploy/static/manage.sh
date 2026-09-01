#!/usr/bin/env bash
set -euo pipefail

readonly root=/var/www/viritura
readonly upload=/home/viritura-deploy/upload-static
readonly lock=/run/lock/viritura-static-deploy.lock
readonly keep_releases=5

exec 9>"$lock"
flock -n 9 || { echo "Another Viritura static deployment is running." >&2; exit 1; }

surface="${1:-}"
case "$surface" in
  website | editor) ;;
  *)
    echo "Usage: viritura-static-manage {website|editor}" >&2
    exit 2
    ;;
esac

readonly uploaded_archive="$upload/$surface.tar.gz"
readonly surface_root="$root/$surface"
readonly releases="$surface_root/releases"
readonly archive="$surface_root/incoming.tar.gz"

[[ -s "$uploaded_archive" ]] || { echo "Missing deployment archive: $uploaded_archive" >&2; exit 1; }
rm -f "$archive"
mv "$uploaded_archive" "$archive"
chown root:root "$archive"
chmod 0400 "$archive"
(( $(stat -c '%s' "$archive") <= 1073741824 )) || {
  echo "Deployment archive exceeds the 1 GiB safety limit." >&2
  exit 1
}

while IFS= read -r entry; do
  case "$entry" in
    /* | ../* | */../* | */..)
      echo "Unsafe archive path: $entry" >&2
      exit 1
      ;;
  esac
done < <(tar -tzf "$archive")

while IFS= read -r listing; do
  case "${listing:0:1}" in
    - | d) ;;
    *)
      echo "Deployment archives may contain only regular files and directories." >&2
      exit 1
      ;;
  esac
done < <(tar -tvzf "$archive")

release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
readonly release="$releases/$release_id"
install -d -o root -g root -m 0755 "$release"

cleanup_failed_release() {
  rm -rf "$release"
}
trap cleanup_failed_release ERR

tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$release"
if find "$release" -type l -print -quit | grep -q .; then
  echo "Deployment archives may not contain symbolic links." >&2
  exit 1
fi
[[ -f "$release/index.html" ]] || {
  echo "Deployment archive does not contain index.html." >&2
  exit 1
}

chown -R root:root "$release"
find "$release" -type d -exec chmod 0755 {} +
find "$release" -type f -exec chmod 0644 {} +

ln -s "$release" "$surface_root/current.next"
mv -Tf "$surface_root/current.next" "$surface_root/current"
rm -f "$archive"
trap - ERR

mapfile -t stale_releases < <(
  find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
    sort -rn |
    tail -n "+$((keep_releases + 1))" |
    cut -d' ' -f2-
)
if ((${#stale_releases[@]} > 0)); then
  rm -rf -- "${stale_releases[@]}"
fi

echo "DEPLOY_OK surface=$surface release=$release_id"