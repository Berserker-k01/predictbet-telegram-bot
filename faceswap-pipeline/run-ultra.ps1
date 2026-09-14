$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Host "Environnement manquant. Relance setup.ps1"
  exit 1
}
& $py (Join-Path $Root "run_ultra.py") @args
