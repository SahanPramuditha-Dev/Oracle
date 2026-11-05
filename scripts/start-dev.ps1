$ErrorActionPreference = 'Stop'
$oracleProject = Split-Path -Parent $PSScriptRoot
$oraclePython = Join-Path $oracleProject 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $oraclePython)) { throw 'Create backend/.venv with Python 3.12 first.' }
foreach ($oraclePort in @(8000)) {
    if (Get-NetTCPConnection -LocalPort $oraclePort -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $oraclePort is already in use. Stop the existing development server first."
    }
}
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    if (-not (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue)) {
        Write-Host 'Starting local Ollama server on 127.0.0.1:11434...'
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 2
    }
}
& $oraclePython (Join-Path $PSScriptRoot 'prepare_dev.py')
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the local connection.' }
if (Test-Path -LiteralPath (Join-Path $oracleProject 'data/postgresql/PG_VERSION')) {
    & $oraclePython (Join-Path $PSScriptRoot 'manage_postgres.py')
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the local records database.' }
}
Write-Host 'ORACLE backend: running at http://127.0.0.1:8000. Press Ctrl+C to stop.'
& $oraclePython -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir (Join-Path $oracleProject 'backend')
