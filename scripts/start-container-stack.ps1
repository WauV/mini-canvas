$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot "docker-compose.yml"
$couchEnv = Join-Path $projectRoot ".local\couchdb.env"
$bridgeEnv = Join-Path $projectRoot ".local\livesync-bridge.env"
$mcpEnv = Join-Path $projectRoot ".local\mcp-server.env"

foreach ($path in @($couchEnv, $bridgeEnv, $mcpEnv)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing container environment file: $path"
  }
}

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCommand) {
  $dockerPath = $dockerCommand.Source
} else {
  $dockerPath = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
}
if (-not (Test-Path -LiteralPath $dockerPath)) {
  throw "Docker was not found. Start Docker Desktop and try again."
}

$resolvedRoot = (Resolve-Path -LiteralPath $projectRoot).Path
$resolvedCompose = (Resolve-Path -LiteralPath $composeFile).Path
$resolvedEnv = (Resolve-Path -LiteralPath $couchEnv).Path

Push-Location -LiteralPath $resolvedRoot
try {
  & $dockerPath compose --env-file $resolvedEnv -f $resolvedCompose up --detach --build --wait --wait-timeout 240
  if ($LASTEXITCODE -ne 0) {
    throw "The Mini Canvas container stack did not become healthy."
  }
} finally {
  Pop-Location
}

Write-Host "Mini Canvas containers are healthy."
Write-Host "CouchDB (Obsidian): http://127.0.0.1:5984"
Write-Host "MCP Server: http://127.0.0.1:3220/mcp"
