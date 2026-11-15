# Runs the standalone Oracle Companion Gateway daemon
$ErrorActionPreference = 'Stop'
$oracleRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $oracleRoot 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
    $pythonExe = 'python.exe'
}
$script = Join-Path $PSScriptRoot 'run_companion_gateway.py'

Write-Host "Starting Oracle Companion Gateway on LAN + Tailscale interfaces..." -ForegroundColor Cyan
& $pythonExe $script
