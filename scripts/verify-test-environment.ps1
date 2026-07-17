$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".local\couchdb.env"
$vaultPath = Join-Path $projectRoot ".local\obsidian-test-vault"

foreach ($line in (Get-Content -LiteralPath $envFile -Encoding utf8)) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#")) {
    continue
  }

  $parts = $trimmed.Split("=", 2)
  if ($parts.Count -eq 2) {
    Set-Item -Path ("Env:" + $parts[0]) -Value $parts[1]
  }
}

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCommand) {
  $dockerPath = $dockerCommand.Source
} else {
  $dockerPath = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
}

$dockerBin = Split-Path -Parent $dockerPath
$env:PATH = $dockerBin + [IO.Path]::PathSeparator + $env:PATH

$containerState = & $dockerPath inspect mini-canvas-couchdb-test --format "{{.State.Status}}" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "The test CouchDB container was not found. Run scripts\setup-test-couchdb.ps1 first."
}
if ($containerState -ne "running") {
  throw "The test CouchDB container is $containerState. Start Docker Desktop and run scripts\setup-test-couchdb.ps1."
}

$publishedPort = & $dockerPath port mini-canvas-couchdb-test 5984/tcp 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Could not inspect the test CouchDB published port."
}
$volumeName = & $dockerPath inspect mini-canvas-couchdb-test --format "{{(index .Mounts 0).Name}}" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Could not inspect the test CouchDB data volume."
}

$baseUrl = "http://127.0.0.1:$($env:COUCHDB_PORT)"
$credential = "$($env:COUCHDB_USER):$($env:COUCHDB_PASSWORD)"
$token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($credential))
$headers = @{ Authorization = "Basic $token" }
$up = Invoke-RestMethod -Uri "$baseUrl/_up" -Headers $headers -Method Get
$databases = Invoke-RestMethod -Uri "$baseUrl/_all_dbs" -Headers $headers -Method Get
$corsRequest = @{
  Uri = "$baseUrl/_node/_local/_config/cors/origins"
  Headers = $headers
  Method = "Get"
}
$corsOrigins = Invoke-RestMethod @corsRequest
$wwwAuthenticate = Invoke-RestMethod -Uri "$baseUrl/_node/_local/_config/httpd/WWW-Authenticate" -Headers $headers -Method Get
$maxRequestSize = Invoke-RestMethod -Uri "$baseUrl/_node/_local/_config/chttpd/max_http_request_size" -Headers $headers -Method Get
$maxDocumentSize = Invoke-RestMethod -Uri "$baseUrl/_node/_local/_config/couchdb/max_document_size" -Headers $headers -Method Get

$anonymousStatus = 200
try {
  $null = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing
} catch {
  $anonymousStatus = [int]$_.Exception.Response.StatusCode
}

$requiredDatabases = @("_users", "_replicator", "_global_changes", $env:COUCHDB_DATABASE)
$missingDatabases = @($requiredDatabases | Where-Object { $_ -notin $databases })
$vaultFiles = Get-ChildItem -LiteralPath $vaultPath -File -Recurse -Force
$liveSyncConfig = Join-Path $vaultPath ".obsidian\plugins\obsidian-livesync\data.json"

if ($publishedPort -ne "127.0.0.1:$($env:COUCHDB_PORT)") {
  throw "CouchDB is not restricted to the loopback interface."
}
if ($volumeName -ne "mini-canvas-couchdb-test-data") {
  throw "The expected isolated CouchDB volume is not mounted."
}
if (-not $up.status -or $missingDatabases.Count -gt 0) {
  throw "CouchDB health or database verification failed."
}
if ($anonymousStatus -ne 401) {
  throw "Anonymous CouchDB access was not rejected."
}
if (-not (Test-Path -LiteralPath $liveSyncConfig)) {
  throw "The isolated test Vault has not been configured with LiveSync yet."
}

$liveSyncSettings = Get-Content -Raw -LiteralPath $liveSyncConfig -Encoding utf8 | ConvertFrom-Json
if (-not $liveSyncSettings.encrypt -or $liveSyncSettings.E2EEAlgorithm -ne "v2") {
  throw "The isolated test Vault is not using LiveSync V2 encryption."
}
if ($liveSyncSettings.hashAlg -ne "xxhash64") {
  throw "The isolated test Vault is not using the expected xxhash64 chunk IDs."
}
if ($corsOrigins -notlike "*app://obsidian.md*") {
  throw "CouchDB CORS does not allow the Obsidian application origin."
}
if ($wwwAuthenticate -ne 'Basic realm="couchdb"') {
  throw "CouchDB WWW-Authenticate is not configured for LiveSync."
}
if ($maxRequestSize -ne "4294967296" -or $maxDocumentSize -ne "50000000") {
  throw "CouchDB LiveSync document size limits do not match the expected test configuration."
}

[pscustomobject]@{
  Container = $containerState
  PublishedPort = $publishedPort
  Volume = $volumeName
  CouchDBHealth = $up.status
  Databases = ($databases -join ", ")
  AnonymousRequest = $anonymousStatus
  CorsOrigins = $corsOrigins
  MaxRequestSize = $maxRequestSize
  MaxDocumentSize = $maxDocumentSize
  TestVaultFiles = $vaultFiles.Count
  IsolatedLiveSyncV2 = $true
  LiveSyncHash = $liveSyncSettings.hashAlg
} | Format-List
