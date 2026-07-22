#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/../.." && pwd)"
env_file="$project_root/deploy/production/.env"
compose_file="$project_root/docker-compose.server.yml"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${1:-$project_root/backups/$timestamp}"

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file" >&2
  exit 1
fi
mkdir -p "$backup_dir"
backup_dir="$(cd -- "$backup_dir" && pwd)"
chmod 700 "$backup_dir"

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
compose=(docker compose --env-file "$env_file" -f "$compose_file")

couchdb_id="$("${compose[@]}" ps --all --quiet couchdb)"
mcp_id="$("${compose[@]}" ps --all --quiet mcp-server)"
if [[ -z "$couchdb_id" || -z "$mcp_id" ]]; then
  echo "Production containers must exist before backup." >&2
  exit 1
fi
mcp_image="$(docker inspect --format '{{.Config.Image}}' "$mcp_id")"

restart_stack=false
restart() {
  if [[ "$restart_stack" == true ]]; then
    "${compose[@]}" up --detach --wait --wait-timeout 300 >/dev/null
  fi
}
trap restart EXIT

"${compose[@]}" stop caddy mcp-server livesync-bridge couchdb >/dev/null
restart_stack=true

docker run --rm --volumes-from "$couchdb_id" \
  -v "$backup_dir:/backup" --entrypoint tar "${COUCHDB_IMAGE:-couchdb:3}" \
  -czf /backup/couchdb-data.tgz -C /opt/couchdb/data .
docker run --rm --volumes-from "$mcp_id" \
  -v "$backup_dir:/backup" --entrypoint tar "$mcp_image" \
  -czf /backup/mcp-server-data.tgz -C /data .

mkdir -p "$backup_dir/config"
cp -a "$project_root/deploy/production/.env" "$backup_dir/config/server.env"
cp -a "$project_root/deploy/production/secrets" "$backup_dir/config/secrets"
chmod -R go-rwx "$backup_dir/config"
(cd "$backup_dir" && sha256sum couchdb-data.tgz mcp-server-data.tgz > SHA256SUMS)

restart
restart_stack=false
trap - EXIT

echo "Encrypted-data and configuration backup created: $backup_dir"
echo "This backup contains credentials and must be stored securely."
