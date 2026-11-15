$ErrorActionPreference = 'Stop'
$oracleModel = Join-Path (Split-Path -Parent $PSScriptRoot) 'models/vision/yolov8m.onnx'
$oracleHash = 'c24487b82ab181c268de9fc8010ed5ee3104269bbb36c6feed64e3650c8f4a09'
if ((Test-Path -LiteralPath $oracleModel) -and (Get-FileHash -LiteralPath $oracleModel -Algorithm SHA256).Hash -eq $oracleHash) { exit 0 }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $oracleModel) | Out-Null
$oracleDownload = $oracleModel + '.download'
Invoke-WebRequest -Uri 'https://huggingface.co/deepghs/yolos/resolve/main/yolov8m/model.onnx' -OutFile $oracleDownload
if ((Get-FileHash -LiteralPath $oracleDownload -Algorithm SHA256).Hash -ne $oracleHash) { throw 'Live detector checksum mismatch' }
Move-Item -LiteralPath $oracleDownload -Destination $oracleModel -Force
Write-Host 'Live object detector installed and verified.'
