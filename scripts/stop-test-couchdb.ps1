$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot "docker-compose.dev.yml"
$envFile = Join-Path $projectRoot ".local\couchdb.env"
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue

if ($dockerCommand) {
  $dockerPath = $dockerCommand.Source
} else {
  $dockerPath = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
}

if (-not (Test-Path -LiteralPath $dockerPath)) {
  throw "Docker was not found."
}

$dockerBin = Split-Path -Parent $dockerPath
$env:PATH = $dockerBin + [IO.Path]::PathSeparator + $env:PATH

& $dockerPath compose --env-file $envFile -f $composeFile down
if ($LASTEXITCODE -ne 0) {
  throw "The test CouchDB environment failed to stop."
}

Write-Host "Test CouchDB stopped. The isolated data volume was preserved."
