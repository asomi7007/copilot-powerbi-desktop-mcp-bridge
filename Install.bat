@echo off
setlocal
chcp 65001 > nul
title Power BI MCP Bridge - Installer

REM ============================================================
REM  Double-click entry point.
REM  This .bat is intentionally ASCII-only so that Korean Windows
REM  cmd.exe (CP949) does not misparse UTF-8 multi-byte sequences.
REM  All localized text is printed by install-all.ps1, which runs
REM  with explicit UTF-8 console encoding.
REM ============================================================

set "SCRIPT=%~dp0scripts\install-all.ps1"

if not exist "%SCRIPT%" (
    echo [ERROR] Could not find install-all.ps1 at:
    echo         %SCRIPT%
    echo.
    echo Run this file from the extracted Bridge folder root.
    echo.
    pause
    exit /b 1
)

echo.
echo ===============================================================
echo   Power BI MCP Bridge - Installer
echo ===============================================================
echo.
echo   Launching PowerShell installer...
echo   Click [Yes] on the UAC prompt when it appears.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
    echo.
    echo [WARN] Installer exited with code %EXITCODE%.
    echo        See the PowerShell output and the log file for details.
    echo.
    pause
)

endlocal
exit /b %EXITCODE%
