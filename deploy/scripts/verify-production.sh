#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/../.." && pwd)"
env_file="$project_root/deploy/production/.env"
compose_file="$project_root/docker-compose.server.yml"

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

compose=(docker compose --env-file "$env_file" -f "$compose_file")
for service in couchdb livesync-bridge mcp-server; do
  container_id="$("${compose[@]}" ps --quiet "$service")"
  if [[ -z "$container_id" ]]; then
    echo "Container is not running: $service" >&2
    exit 1
  fi
  state="$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id")"
  if [[ "$state" != "running healthy" ]]; then
    echo "Container is not healthy: $service ($state)" >&2
    exit 1
  fi
done

caddy_id="$("${compose[@]}" ps --quiet caddy)"
if [[ -z "$caddy_id" || "$(docker inspect --format '{{.State.Status}}' "$caddy_id")" != "running" ]]; then
  echo "Caddy is not running." >&2
  exit 1
fi

curl --fail --silent --show-error "https://$MCP_DOMAIN/healthz" >/dev/null
mcp_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  "https://$MCP_DOMAIN/mcp")"
if [[ "$mcp_status" != "401" ]]; then
  echo "Public MCP endpoint must reject unauthenticated requests (got $mcp_status)." >&2
  exit 1
fi

couchdb_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  "https://$COUCHDB_DOMAIN/")"
if [[ "$couchdb_status" != "401" ]]; then
  echo "Public CouchDB endpoint must require authentication (got $couchdb_status)." >&2
  exit 1
fi

echo "Production containers, TLS endpoints, and unauthenticated rejection checks passed."
