# Recrée le venv 3.12 et installe FaceFusion (CUDA) SANS toucher au Python système
$ErrorActionPreference = "Stop"
$env:Path = "C:\Users\ROG FLOW\.local\bin;$env:Path"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Vendor = Join-Path $Root "vendor\facefusion"

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host "uv manquant. Installe: irm https://astral.sh/uv/install.ps1 | iex"
  exit 1
}

uv python install 3.12
if (-not (Test-Path $Vendor)) {
  git clone --depth 1 https://github.com/facefusion/facefusion.git $Vendor
}

Set-Location $Root
if (-not (Test-Path (Join-Path $Root ".venv\Scripts\python.exe"))) {
  uv venv --python 3.12 .venv
}

uv pip install --python .venv `
  "gradio-rangeslider==0.0.8" `
  "gradio==5.50.0" `
  "numpy==2.4.6" `
  "onnx==1.22.0" `
  "opencv-python-headless==5.0.0.93" `
  "tqdm==4.70.0" `
  "scipy==1.18.0" `
  "onnxruntime-gpu==1.24.4"

New-Item -ItemType Directory -Force -Path (Join-Path $Root "input\faces") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "input\driving") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "output") | Out-Null

Write-Host "OK. Photos → input\faces  |  Video → input\driving"
Write-Host "Rendu:  .\run-ultra.ps1"
Write-Host "Live:   .\run-live.ps1"
