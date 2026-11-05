$ErrorActionPreference = 'Stop'
$oracleModelRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'models/vision'
New-Item -ItemType Directory -Path $oracleModelRoot -Force | Out-Null
$oracleModels = @(
  @{Name='yolov8s-worldv2.onnx'; Url='https://huggingface.co/Instemic/yolo-world-onnx/resolve/7e1d02c9467c32b141df81890737490764776785/yolov8s-worldv2.onnx'; Hash='381ced485b23ed8f06de3e82bb2745e1420c181c64f0a176784c34a959d550a1'},
  @{Name='clip-text.onnx'; Url='https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/6b7c523703ae26e39be4b03774966f8571c7f523/onnx/text_model.onnx'; Hash='3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc'},
  @{Name='clip-tokenizer.json'; Url='https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/6b7c523703ae26e39be4b03774966f8571c7f523/tokenizer.json'; Hash='f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd'}
)
foreach ($oracleModel in $oracleModels) {
  $oracleDestination = Join-Path $oracleModelRoot $oracleModel.Name
  if ((Test-Path -LiteralPath $oracleDestination) -and (Get-FileHash -LiteralPath $oracleDestination -Algorithm SHA256).Hash -eq $oracleModel.Hash) { continue }
  $oracleTemporary = $oracleDestination + '.download'
  Invoke-WebRequest -Uri $oracleModel.Url -OutFile $oracleTemporary
  if ((Get-FileHash -LiteralPath $oracleTemporary -Algorithm SHA256).Hash -ne $oracleModel.Hash) { throw ('Model checksum mismatch: ' + $oracleModel.Name) }
  Move-Item -LiteralPath $oracleTemporary -Destination $oracleDestination -Force
}
Write-Host 'Local object models installed and SHA-256 verified.'
