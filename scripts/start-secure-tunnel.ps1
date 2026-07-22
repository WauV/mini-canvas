$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$localDirectory = Join-Path $projectRoot ".local"
$clientDirectory = Join-Path $localDirectory "tunnel-client"
$client = Join-Path $clientDirectory "tunnel-client.exe"
$profileDirectory = Join-Path $clientDirectory "profiles"
$profile = Join-Path $profileDirectory "mini-canvas.yaml"
$apiKeyFile = Join-Path $clientDirectory "control-plane-api-key.txt"
$mcpEnvironment = Join-Path $localDirectory "mcp-server.env"

function Get-ControlPlaneProxy {
  try {
    $internetSettings = Get-ItemProperty `
      -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
    if ([int]$internetSettings.ProxyEnable -ne 1) {
      return $null
    }

    $proxyServer = [string]$internetSettings.ProxyServer
    if (-not $proxyServer) {
      return $null
    }

    if ($proxyServer.Contains("=")) {
      $proxyByProtocol = @{}
      foreach ($entry in $proxyServer.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries)) {
        $parts = $entry.Split("=", 2)
        if ($parts.Count -eq 2) {
          $proxyByProtocol[$parts[0].Trim().ToLowerInvariant()] = $parts[1].Trim()
        }
      }
      $proxyServer = if ($proxyByProtocol.ContainsKey("https")) {
        [string]$proxyByProtocol["https"]
      }
      elseif ($proxyByProtocol.ContainsKey("http")) {
        [string]$proxyByProtocol["http"]
      }
      else {
        ""
      }
    }

    if (-not $proxyServer) {
      return $null
    }
    if ($proxyServer -notmatch "^[a-z][a-z0-9+.-]*://") {
      $proxyServer = "http://$proxyServer"
    }
    return $proxyServer
  }
  catch {
    Write-Warning "Could not read the Windows proxy configuration; continuing without a control-plane proxy."
    return $null
  }
}

foreach ($path in @($client, $profile, $apiKeyFile, $mcpEnvironment)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing required Tunnel file: $path"
  }
}

$apiKey = (Get-Content -LiteralPath $apiKeyFile -Raw).Trim()
if (-not $apiKey) {
  throw "The Tunnel runtime API key is empty. Run npm run tunnel:save-key first."
}

$authLine = Get-Content -LiteralPath $mcpEnvironment | Where-Object {
  $_.Trim().StartsWith("MINI_CANVAS_MCP_AUTH_JSON=")
} | Select-Object -First 1
if (-not $authLine) {
  throw "MINI_CANVAS_MCP_AUTH_JSON is missing from .local/mcp-server.env."
}

$authJson = $authLine.Substring($authLine.IndexOf("=") + 1)
$identities = @($authJson | ConvertFrom-Json)
$mcpToken = [string]$identities[0].token
if (-not $mcpToken) {
  throw "The local MCP identity does not contain a token."
}

$env:CONTROL_PLANE_API_KEY = $apiKey
$env:MINI_CANVAS_TUNNEL_MCP_AUTHORIZATION = "Bearer $mcpToken"
$header = "Authorization: env:MINI_CANVAS_TUNNEL_MCP_AUTHORIZATION"
$controlPlaneProxy = Get-ControlPlaneProxy
$controlPlaneArguments = @()
if ($controlPlaneProxy) {
  $controlPlaneArguments = @("--control-plane.http-proxy", $controlPlaneProxy)
  Write-Host "Using the Windows proxy for the OpenAI control plane: $controlPlaneProxy"
}

try {
  $doctorOutput = @(& $client doctor `
    --profile mini-canvas `
    --profile-dir $profileDirectory `
    --mcp.extra-headers $header `
    --mcp.discovery-extra-headers $header `
    @controlPlaneArguments `
    --explain 2>&1)
  $doctorExitCode = $LASTEXITCODE
  $doctorOutput | Write-Output

  if ($doctorExitCode -ne 0) {
    $failedChecks = @($doctorOutput | Where-Object {
      [string]$_ -match '^FAILED_CHECKS\s+'
    })
    $onlyExpectedMissingOAuthMetadata =
      $failedChecks.Count -eq 1 -and
      [string]$failedChecks[0] -eq "FAILED_CHECKS oauth_metadata"

    if (-not $onlyExpectedMissingOAuthMetadata) {
      throw "Tunnel diagnostics failed. Fix the failed checks before starting the Tunnel."
    }

    Write-Warning "The local MCP uses a Tunnel-injected Bearer token and intentionally does not publish OAuth metadata; continuing with the secured local hop."
  }

  Write-Host "Tunnel diagnostics passed. Keep this window open while using Mini Canvas in ChatGPT."
  & $client run `
    --profile mini-canvas `
    --profile-dir $profileDirectory `
    --mcp.extra-headers $header `
    --mcp.discovery-extra-headers $header `
    @controlPlaneArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Tunnel client stopped with exit code $LASTEXITCODE."
  }
}
finally {
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:MINI_CANVAS_TUNNEL_MCP_AUTHORIZATION -ErrorAction SilentlyContinue
  $apiKey = $null
  $mcpToken = $null
}
