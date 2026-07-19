$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot "docker-compose.yml"
$couchEnv = Join-Path $projectRoot ".local\couchdb.env"

if (-not (Test-Path -LiteralPath $couchEnv)) {
  throw "Missing local CouchDB environment file: $couchEnv"
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
  # Deliberately omit --volumes: CouchDB ciphertext and encrypted drafts persist.
  & $dockerCommand.Source compose --env-file $resolvedEnv -f $resolvedCompose down --remove-orphans
  if ($LASTEXITCODE -ne 0) {
    throw "The Mini Canvas container stack could not be stopped cleanly."
  }
} finally {
  Pop-Location
}

Write-Host "Mini Canvas containers stopped; persistent volumes were retained."
