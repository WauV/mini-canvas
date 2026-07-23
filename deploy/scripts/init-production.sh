#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <mcp-domain> <couchdb-domain> <acme-email>" >&2
  exit 2
fi

mcp_domain="$1"
couchdb_domain="$2"
acme_email="$3"

domain_pattern='^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$'
if [[ ! "$mcp_domain" =~ $domain_pattern || ! "$couchdb_domain" =~ $domain_pattern ]]; then
  echo "Domains must be plain host names without a scheme, port, path, or wildcard." >&2
  exit 2
fi
if [[ "$mcp_domain" == "$couchdb_domain" ]]; then
  echo "MCP and CouchDB must use different host names." >&2
  exit 2
fi
if [[ "$acme_email" != *@* ]]; then
  echo "A valid ACME contact email is required." >&2
  exit 2
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required." >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/../.." && pwd)"
production_dir="$project_root/deploy/production"
secrets_dir="$production_dir/secrets"

if [[ -e "$production_dir/.env" || -e "$secrets_dir" ]]; then
  echo "Production configuration already exists. Refusing to overwrite it." >&2
  exit 1
fi

umask 077
mkdir -p "$secrets_dir"

couchdb_admin_password="$(openssl rand -hex 32)"
couchdb_app_password="$(openssl rand -hex 32)"
livesync_passphrase="$(openssl rand -hex 32)"
bridge_token="$(openssl rand -hex 32)"
mcp_master_key="$(openssl rand -base64 32 | tr -d '\r\n')"
mcp_token="$(openssl rand -hex 32)"

cat > "$production_dir/.env" <<EOF
MCP_DOMAIN=$mcp_domain
COUCHDB_DOMAIN=$couchdb_domain
ACME_EMAIL=$acme_email
MINI_CANVAS_IMAGE_TAG=server
COUCHDB_IMAGE=couchdb:3
CADDY_IMAGE=public.ecr.aws/docker/library/caddy:2-alpine
NODE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim
EOF

cat > "$secrets_dir/couchdb-admin.env" <<EOF
COUCHDB_USER=mini_canvas_admin
COUCHDB_PASSWORD=$couchdb_admin_password
EOF

cat > "$secrets_dir/couchdb-app.env" <<EOF
COUCHDB_DATABASE=mini_canvas
COUCHDB_APP_USER=mini_canvas_sync
COUCHDB_APP_PASSWORD=$couchdb_app_password
EOF

cat > "$secrets_dir/livesync.env" <<EOF
LIVESYNC_PASSPHRASE=$livesync_passphrase
LIVESYNC_CASE_INSENSITIVE=true
LIVESYNC_BRIDGE_MAX_ATTACHMENT_BYTES=20971520
EOF

cat > "$secrets_dir/bridge-token.env" <<EOF
LIVESYNC_BRIDGE_TOKEN=$bridge_token
MINI_CANVAS_BRIDGE_TOKEN=$bridge_token
EOF

cat > "$secrets_dir/mcp-server.env" <<EOF
MINI_CANVAS_MCP_MASTER_KEY_BASE64=$mcp_master_key
MINI_CANVAS_DEFAULT_TENANT_ID=local-vault
MINI_CANVAS_MCP_AUTH_JSON=[{"token":"$mcp_token","userId":"server-user","tenantId":"local-vault","scopes":["notes:read","vault:list","attachments:read","drafts:write","drafts:commit","search:read","search:refresh"],"allowedPaths":[""]}]
MINI_CANVAS_MCP_AUTO_INDEX=true
MINI_CANVAS_VAULT_CASE_INSENSITIVE=true
MINI_CANVAS_MCP_DRAFT_RETENTION_DAYS=30
EOF

chmod 600 "$production_dir/.env" "$secrets_dir"/*.env

unset couchdb_admin_password couchdb_app_password livesync_passphrase
unset bridge_token mcp_master_key mcp_token

echo "Production configuration created under deploy/production/."
echo "Point both DNS names at this server before deploying:"
echo "  $mcp_domain"
echo "  $couchdb_domain"
echo "Secrets were not printed. Back up deploy/production securely."
