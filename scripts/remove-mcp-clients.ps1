$ErrorActionPreference = "Stop"

$serverName = "mini-canvas"
$claude = Get-Command claude -ErrorAction SilentlyContinue
$gemini = Get-Command gemini -ErrorAction SilentlyContinue

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
    # Removing a missing entry is still a successful cleanup.
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

if ($claude) {
  Remove-ClientConfiguration -Executable $claude.Source -Scope "local"
  Write-Host "Claude Code: project-local Mini Canvas MCP removed if it existed."
}

if ($gemini) {
  Remove-ClientConfiguration -Executable $gemini.Source -Scope "project"
  Write-Host "Gemini CLI: project-local Mini Canvas MCP removed if it existed."
}

if (-not $claude -and -not $gemini) {
  Write-Warning "Claude Code and Gemini CLI were not found; nothing to remove."
}
