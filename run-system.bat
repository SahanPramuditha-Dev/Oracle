@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-system.ps1"
if errorlevel 1 (
    echo.
    echo ORACLE could not start. See the error above.
    pause
    exit /b 1
)
endlocal
