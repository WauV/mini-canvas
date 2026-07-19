$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$targetDirectory = Join-Path $projectRoot ".local\tunnel-client"
$target = Join-Path $targetDirectory "control-plane-api-key.txt"

$secureKey = Read-Host "Paste the OpenAI tunnel runtime API key" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ([string]::IsNullOrWhiteSpace($plainKey)) {
    throw "The API key cannot be empty."
  }

  New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
  [IO.File]::WriteAllText($target, $plainKey.Trim(), [Text.UTF8Encoding]::new($false))
}
finally {
  if ($pointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
  $plainKey = $null
  $secureKey.Dispose()
}

Write-Host "Tunnel runtime key saved locally under .local/ (Git ignored)."

