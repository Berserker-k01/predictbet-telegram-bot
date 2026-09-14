$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $Root ".venv\Scripts\python.exe"
$Vendor = Join-Path $Root "vendor\facefusion"
if (-not (Test-Path $py) -or -not (Test-Path (Join-Path $Vendor "facefusion.py"))) {
  Write-Host "Environnement manquant. Relance setup.ps1"
  exit 1
}
Write-Host "UI live — coche face_swapper + expression_restorer + face_enhancer"
Write-Host "swap: hyperswap_1a_256 | enhance: gfpgan_1.4 | restorer: live_portrait"
Set-Location $Vendor
& $py facefusion.py run --open-browser
