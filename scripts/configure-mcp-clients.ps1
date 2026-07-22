$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $projectRoot ".local\mcp-server.env"
$serverUrl = "http://127.0.0.1:3220/mcp"
$serverName = "mini-canvas"

function Read-EnvironmentValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $prefix = "$Name="
  $line = Get-Content -LiteralPath $Path | Where-Object {
    $_.StartsWith($prefix, [System.StringComparison]::Ordinal)
  } | Select-Object -First 1
  if (-not $line) {
    throw "Missing $Name in $Path."
  }

  $value = $line.Substring($prefix.Length).Trim()
  if (
    $value.Length -ge 2 -and
    (($value[0] -eq [char]34 -and $value[$value.Length - 1] -eq [char]34) -or
      ($value[0] -eq [char]39 -and $value[$value.Length - 1] -eq [char]39))
  ) {
    return $value.Substring(1, $value.Length - 2)
  }
  return $value
}

function Invoke-ClientCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  & $Executable @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

function Remove-ClientConfiguration {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][ValidateSet("local", "project")][string]$Scope
  )

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $Executable mcp remove --scope $Scope $serverName 2>&1 | Out-Null
  } catch {
    # Removing a missing entry is expected on the first setup run.
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

if (-not (Test-Path -LiteralPath $environmentPath)) {
  throw "Missing $environmentPath. Run npm run container:up or scripts/setup-mcp-env.ps1 first."
}

$rawAuth = Read-EnvironmentValue -Path $environmentPath -Name "MINI_CANVAS_MCP_AUTH_JSON"
$auth = $rawAuth | ConvertFrom-Json
if ($auth -is [System.Array]) {
  $auth = $auth | Select-Object -First 1
}
$token = [string]$auth.token
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "MINI_CANVAS_MCP_AUTH_JSON does not contain a usable token."
}

$claude = Get-Command claude -ErrorAction SilentlyContinue
$gemini = Get-Command gemini -ErrorAction SilentlyContinue
if (-not $claude -and -not $gemini) {
  throw "Claude Code and Gemini CLI were not found."
}

try {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3220/health" -TimeoutSec 3
    if (-not $health) {
      Write-Warning "Mini Canvas MCP health check returned no content; configuration will continue."
    }
  } catch {
    Write-Warning "Mini Canvas MCP is unavailable. Configuration will be saved; run npm run container:up before use."
  }

  $authorizationHeader = "Authorization: Bearer $token"

  if ($claude) {
    Remove-ClientConfiguration -Executable $claude.Source -Scope "local"
    Invoke-ClientCommand -Executable $claude.Source -Arguments @(
      "mcp", "add",
      "--transport", "http",
      "--scope", "local",
      $serverName, $serverUrl,
      "--header", $authorizationHeader
    ) -FailureMessage "Failed to configure Mini Canvas MCP for Claude Code."
    Write-Host "Claude Code: project-local Mini Canvas MCP configured."
  } else {
    Write-Warning "Claude Code was not found and was skipped."
  }

  if ($gemini) {
    Remove-ClientConfiguration -Executable $gemini.Source -Scope "project"
    Invoke-ClientCommand -Executable $gemini.Source -Arguments @(
      "mcp", "add",
      "--transport", "http",
      "--scope", "project",
      "--description", "Edit the isolated Obsidian test Vault through encrypted Mini Canvas drafts.",
      $serverName, $serverUrl,
      "--header", $authorizationHeader
    ) -FailureMessage "Failed to configure Mini Canvas MCP for Gemini CLI."
    Write-Host "Gemini CLI: project-local Mini Canvas MCP configured."
    Write-Host "Gemini CLI: on first use, open this project and approve its folder-trust prompt."
  } else {
    Write-Warning "Gemini CLI was not found and was skipped."
  }
} finally {
  $authorizationHeader = $null
  $token = $null
  $rawAuth = $null
  $auth = $null
}

Write-Host "Done. Gemini --trust remains disabled, so write tools still require confirmation."
