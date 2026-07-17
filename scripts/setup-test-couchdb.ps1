$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot "docker-compose.dev.yml"
$envFile = Join-Path $projectRoot ".local\couchdb.env"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing local CouchDB environment file: $envFile"
}

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCommand) {
  $dockerPath = $dockerCommand.Source
} else {
  $dockerPath = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
}

if (-not (Test-Path -LiteralPath $dockerPath)) {
  throw "Docker was not found. Install and start Docker Desktop first."
}

$dockerBin = Split-Path -Parent $dockerPath
$env:PATH = $dockerBin + [IO.Path]::PathSeparator + $env:PATH

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

& $dockerPath compose --env-file $envFile -f $composeFile up -d couchdb-test
if ($LASTEXITCODE -ne 0) {
  throw "The test CouchDB container failed to start."
}

$baseUrl = "http://127.0.0.1:$($env:COUCHDB_PORT)"
$credential = "$($env:COUCHDB_USER):$($env:COUCHDB_PASSWORD)"
$token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($credential))
$headers = @{ Authorization = "Basic $token" }
$ready = $false

for ($attempt = 1; $attempt -le 45; $attempt += 1) {
  try {
    $null = Invoke-RestMethod -Uri "$baseUrl/_up" -Headers $headers -Method Get
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $ready) {
  throw "The test CouchDB did not become ready within 45 seconds."
}

foreach ($database in @("_users", "_replicator", "_global_changes", $env:COUCHDB_DATABASE)) {
  try {
    $request = @{
      Uri = "$baseUrl/$database"
      Headers = $headers
      Method = "Put"
    }
    $null = Invoke-RestMethod @request
  } catch {
    $statusCode = [int]$_.Exception.Response.StatusCode
    if ($statusCode -ne 412) {
      throw
    }
  }
}

$configuration = [ordered]@{
  "httpd/WWW-Authenticate" = 'Basic realm="couchdb"'
  "chttpd/enable_cors" = "true"
  "chttpd/max_http_request_size" = "4294967296"
  "couchdb/max_document_size" = "50000000"
  "cors/credentials" = "true"
  "cors/origins" = "app://obsidian.md, capacitor://localhost, http://localhost"
  "cors/headers" = "accept, authorization, content-type, origin, referer"
  "cors/methods" = "GET, PUT, POST, HEAD, DELETE"
  "cors/max_age" = "3600"
  "chttpd/require_valid_user" = "true"
}

foreach ($entry in $configuration.GetEnumerator()) {
  $request = @{
    Uri = "$baseUrl/_node/_local/_config/$($entry.Key)"
    Headers = $headers
    Method = "Put"
    ContentType = "application/json"
    Body = ConvertTo-Json $entry.Value -Compress
  }
  $null = Invoke-RestMethod @request
}

Write-Host "Test CouchDB is ready: $baseUrl"
Write-Host "Test database is ready: $($env:COUCHDB_DATABASE)"
Write-Host "Test Vault: $(Join-Path $projectRoot '.local\obsidian-test-vault')"
