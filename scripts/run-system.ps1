$ErrorActionPreference = 'Stop'
$oracleRoot = Split-Path -Parent $PSScriptRoot
$oracleLogs = Join-Path $oracleRoot 'data/dev/logs'
New-Item -ItemType Directory -Force -Path $oracleLogs | Out-Null

function Test-OracleUrl([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch { return $false }
}

function Wait-OracleUrl([string]$Url, [string]$Service) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        if (Test-OracleUrl $Url) { return }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    throw "$Service did not become ready. Check logs in $oracleLogs"
}

function Test-OraclePort([int]$Port) {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        $listener.Stop()
    }
}

$frontendPort = 5173
if (-not (Test-OraclePort $frontendPort) -and (Test-OraclePort 3000)) {
    $frontendPort = 3000
}
$frontendUrl = "http://127.0.0.1:$frontendPort"

$ollamaUrl = if (Test-OracleUrl 'http://127.0.0.1:11420/api/tags') { 'http://127.0.0.1:11420/api/tags' } else { 'http://127.0.0.1:11434/api/tags' }
if (-not (Test-OracleUrl $ollamaUrl)) {
    if (Get-Command ollama -ErrorAction SilentlyContinue) {
        $env:OLLAMA_HOST = '127.0.0.1:11420'
        Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $oracleLogs 'ollama.log') `
            -RedirectStandardError (Join-Path $oracleLogs 'ollama-error.log')
        Wait-OracleUrl 'http://127.0.0.1:11420/api/tags' 'Local AI server'
    }
}

if (-not (Test-OracleUrl 'http://127.0.0.1:8000/api/v1/health')) {
    $oracleStart = Join-Path $PSScriptRoot 'start-dev.ps1'
    Start-Process -FilePath 'powershell.exe' `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$oracleStart`"" `
        -WorkingDirectory $oracleRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $oracleLogs 'backend.log') `
        -RedirectStandardError (Join-Path $oracleLogs 'backend-error.log')
    Wait-OracleUrl 'http://127.0.0.1:8000/api/v1/health' 'ORACLE backend'
}

if (-not (Test-OracleUrl $frontendUrl)) {
    $oracleNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
    Start-Process -FilePath $env:ComSpec `
        -ArgumentList "/d /s /c `"`"$oracleNpm`" run dev -- --port $frontendPort`"" `
        -WorkingDirectory (Join-Path $oracleRoot 'frontend') -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $oracleLogs 'frontend.log') `
        -RedirectStandardError (Join-Path $oracleLogs 'frontend-error.log')
    Wait-OracleUrl $frontendUrl 'ORACLE frontend'
}

Write-Host "ORACLE is running at $frontendUrl"
Start-Process $frontendUrl
