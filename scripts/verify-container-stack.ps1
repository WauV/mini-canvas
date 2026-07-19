$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot "docker-compose.yml"
$couchEnv = Join-Path $projectRoot ".local\couchdb.env"
$mcpEnv = Join-Path $projectRoot ".local\mcp-server.env"

foreach ($path in @($couchEnv, $mcpEnv)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing local container environment file: $path"
  }
}

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCommand) {
  throw "Docker was not found."
}

$resolvedRoot = (Resolve-Path -LiteralPath $projectRoot).Path
$resolvedCompose = (Resolve-Path -LiteralPath $composeFile).Path
$resolvedEnv = (Resolve-Path -LiteralPath $couchEnv).Path

Push-Location -LiteralPath $resolvedRoot
try {
  & $dockerCommand.Source compose --env-file $resolvedEnv -f $resolvedCompose config --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose configuration is invalid."
  }

  $containerIds = @{}
  $services = @("couchdb-test", "livesync-bridge", "mcp-server")
  foreach ($service in $services) {
    $containerId = (& $dockerCommand.Source compose --env-file $resolvedEnv -f $resolvedCompose ps --quiet $service).Trim()
    if (-not $containerId) {
      throw "Container is not running: $service"
    }
    $state = (& $dockerCommand.Source inspect --format "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}" $containerId).Trim()
    if ($state -notmatch "^running healthy$") {
      throw "Container is not healthy: $service ($state)"
    }
    $containerIds[$service] = $containerId
  }

  $bridgePortBindings = (& $dockerCommand.Source inspect --format "{{json .HostConfig.PortBindings}}" $containerIds["livesync-bridge"]).Trim()
  if ($bridgePortBindings -ne "{}" -and $bridgePortBindings -ne "null") {
    throw "LiveSync Bridge must not publish a host port."
  }
} finally {
  Pop-Location
}

$health = Invoke-RestMethod -Uri "http://127.0.0.1:3220/health" -Method Get
if (-not $health.ok -or $health.bridge -ne "ready") {
  throw "MCP health endpoint is not ready."
}

$authLine = Get-Content -LiteralPath $mcpEnv -Encoding utf8 | Where-Object {
  $_.Trim().StartsWith("MINI_CANVAS_MCP_AUTH_JSON=")
} | Select-Object -First 1
if (-not $authLine) {
  throw "MCP authentication configuration is missing."
}
$authJson = $authLine.Substring($authLine.IndexOf("=") + 1).Trim()
if (
  $authJson.Length -ge 2 -and
  (($authJson.StartsWith('"') -and $authJson.EndsWith('"')) -or
   ($authJson.StartsWith("'") -and $authJson.EndsWith("'")))
) {
  $authJson = $authJson.Substring(1, $authJson.Length - 2)
}
$identity = ($authJson | ConvertFrom-Json)[0]
if (-not $identity.token) {
  throw "MCP authentication token is missing."
}
$headers = @{
  Accept = "application/json, text/event-stream"
  Authorization = "Bearer $($identity.token)"
}
$toolRequest = @{
  jsonrpc = "2.0"
  id = 1
  method = "tools/call"
  params = @{
    name = "list_entries"
    arguments = @{ limit = 1 }
  }
} | ConvertTo-Json -Depth 6 -Compress
$toolResult = Invoke-RestMethod `
  -Uri "http://127.0.0.1:3220/mcp" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $toolRequest
if ($toolResult.error -or $toolResult.result.isError) {
  throw "Authenticated MCP list_entries smoke test failed."
}

Write-Host "Container isolation and health checks passed."
