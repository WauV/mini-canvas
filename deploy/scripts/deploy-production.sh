#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/../.." && pwd)"
env_file="$project_root/deploy/production/.env"
compose_file="$project_root/docker-compose.server.yml"

required_files=(
  "$env_file"
  "$project_root/deploy/production/secrets/couchdb-admin.env"
  "$project_root/deploy/production/secrets/couchdb-app.env"
  "$project_root/deploy/production/secrets/livesync.env"
  "$project_root/deploy/production/secrets/bridge-token.env"
  "$project_root/deploy/production/secrets/mcp-server.env"
)
for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing production configuration: $path" >&2
    exit 1
  fi
done
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker with the Compose plugin is required." >&2
  exit 1
fi

cd "$project_root"
docker compose --env-file "$env_file" -f "$compose_file" config --quiet
docker compose --env-file "$env_file" -f "$compose_file" up \
  --detach --build --wait --wait-timeout 300

echo "Mini Canvas production containers are running."
echo "Run deploy/scripts/verify-production.sh after DNS and TLS are ready."
