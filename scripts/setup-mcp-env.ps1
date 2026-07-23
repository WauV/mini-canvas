param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$localDirectory = Join-Path $projectRoot ".local"
$target = Join-Path $localDirectory "mcp-server.env"
$bridgeEnvironment = Join-Path $localDirectory "livesync-bridge.env"

if ((Test-Path -LiteralPath $target) -and -not $Force) {
  Write-Host "MCP environment already exists: .local/mcp-server.env"
  exit 0
}
if (-not (Test-Path -LiteralPath $bridgeEnvironment)) {
  throw "Missing .local/livesync-bridge.env. Configure the isolated Bridge first."
}

$bridgeValues = @{}
foreach ($rawLine in Get-Content -LiteralPath $bridgeEnvironment) {
  $line = $rawLine.Trim()
  if (-not $line -or $line.StartsWith("#")) { continue }
  $separator = $line.IndexOf("=")
  if ($separator -lt 1) { continue }
  $key = $line.Substring(0, $separator).Trim()
  $value = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
  $bridgeValues[$key] = $value
}
if (-not $bridgeValues.ContainsKey("LIVESYNC_BRIDGE_TOKEN")) {
  throw "Missing LIVESYNC_BRIDGE_TOKEN in .local/livesync-bridge.env"
}

function New-RandomBase64([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($buffer)
  }
  finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($buffer)
}

$masterKey = New-RandomBase64 32
$mcpToken = New-RandomBase64 32
$identityRecord = @{
  token = $mcpToken
  userId = "local-user"
  tenantId = "local-vault"
  scopes = @(
    "notes:read",
    "vault:list",
    "attachments:read",
    "drafts:write",
    "drafts:commit",
    "search:read",
    "search:refresh"
  )
  allowedPaths = @((""))
}
$identity = ConvertTo-Json -InputObject @($identityRecord) -Compress -Depth 5

$lines = @(
  "MINI_CANVAS_MCP_PORT=3220",
  "MINI_CANVAS_MCP_DB=.local/mcp-server.sqlite",
  "MINI_CANVAS_DEFAULT_TENANT_ID=local-vault",
  "MINI_CANVAS_MCP_MASTER_KEY_BASE64=$masterKey",
  "MINI_CANVAS_MCP_AUTH_JSON=$identity",
  "MINI_CANVAS_BRIDGE_URL=http://127.0.0.1:3210",
  "MINI_CANVAS_BRIDGE_TOKEN=$($bridgeValues['LIVESYNC_BRIDGE_TOKEN'])",
  "MINI_CANVAS_MCP_AUTO_INDEX=true",
  "MINI_CANVAS_VAULT_CASE_INSENSITIVE=true"
)

New-Item -ItemType Directory -Force -Path $localDirectory | Out-Null
[IO.File]::WriteAllLines($target, $lines, [Text.UTF8Encoding]::new($false))
Write-Host "Created .local/mcp-server.env with independent random keys."
