#!/usr/bin/env bash
set -euo pipefail

# Daily SQLite backup with the same tiered retention policy as Moomie:
# seven daily, one per ISO week through day 35, one per month through year one.
container="viritura-api"
data_dir="/var/lib/viritura/data"
today="$(date -u +%F)"
tmp="${data_dir}/backup-${today}.db.tmp"
dst="${data_dir}/backup-${today}.db"

docker exec "$container" rm -f "$tmp"
docker exec "$container" sqlite3 "${data_dir}/viritura.db" ".backup '${tmp}'"
check="$(docker exec "$container" sqlite3 "$tmp" 'PRAGMA quick_check;')"
if [[ "$check" != "ok" ]]; then
  docker exec "$container" rm -f "$tmp"
  echo "SQLite backup integrity check failed: $check" >&2
  exit 1
fi
docker exec "$container" mv -f "$tmp" "$dst"
echo "Wrote $dst"

declare -A seen_week=()
declare -A seen_month=()
now_epoch="$(date -u +%s)"

mapfile -t files < <(
  docker exec "$container" sh -c \
    "find '$data_dir' -maxdepth 1 -type f -name 'backup-????-??-??.db' -printf '%f\n' | sort -r"
)

for file in "${files[@]}"; do
  backup_date="${file:7:10}"
  backup_epoch="$(date -u -d "${backup_date}T00:00:00Z" +%s)"
  age_days=$(( (now_epoch - backup_epoch) / 86400 ))
  keep=false

  if (( age_days < 7 )); then
    keep=true
  elif (( age_days < 35 )); then
    week="$(date -u -d "$backup_date" +%G-W%V)"
    if [[ -z "${seen_week[$week]:-}" ]]; then
      seen_week[$week]=1
      keep=true
    fi
  elif (( age_days < 365 )); then
    month="${backup_date:0:7}"
    if [[ -z "${seen_month[$month]:-}" ]]; then
      seen_month[$month]=1
      keep=true
    fi
  fi

  if [[ "$keep" == false ]]; then
    docker exec "$container" rm -f "${data_dir}/${file}"
    echo "Pruned $file"
  fi
done