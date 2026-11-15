# Registers Oracle Companion Gateway to automatically start in the background upon Windows logon.
$ErrorActionPreference = 'Stop'
$oracleRoot = Split-Path -Parent $PSScriptRoot
$pythonwExe = Join-Path $oracleRoot 'backend\.venv\Scripts\pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonwExe)) {
    $pythonwExe = Join-Path $oracleRoot 'backend\.venv\Scripts\python.exe'
}
$script = Join-Path $PSScriptRoot 'run_companion_gateway.py'
$startupFolder = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'OracleCompanionGateway.lnk'

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pythonwExe
$shortcut.Arguments = "`"$script`""
$shortcut.WorkingDirectory = $oracleRoot
$shortcut.Description = "Oracle Companion Persistent Background Gateway (LAN & Tailscale)"
$shortcut.Save()

Write-Host "Success! Oracle Companion Gateway autostart shortcut created at:" -ForegroundColor Green
Write-Host $shortcutPath -ForegroundColor Yellow
Write-Host "The gateway will now quietly run in the background on startup, allowing phone control anytime." -ForegroundColor Cyan
