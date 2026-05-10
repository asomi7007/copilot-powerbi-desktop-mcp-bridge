@echo off
setlocal
chcp 65001 > nul
title Power BI MCP Bridge - Installer

REM 더블클릭 진입점.
REM PowerShell 5.1 기본 동봉 Windows 10/11에서 동작.
REM install-all.ps1이 내부적으로 UAC 자동 승격을 수행하므로
REM 여기서는 단순히 PowerShell을 호출하기만 한다.

set "SCRIPT=%~dp0scripts\install-all.ps1"

if not exist "%SCRIPT%" (
    echo [ERROR] 설치 스크립트를 찾을 수 없습니다:
    echo         %SCRIPT%
    echo.
    echo 이 파일은 Bridge 프로젝트 루트에서 실행되어야 합니다.
    echo.
    pause
    exit /b 1
)

echo.
echo ===============================================================
echo   Power BI MCP Bridge - 통합 설치 마법사
echo ===============================================================
echo.
echo   잠시 후 PowerShell 창이 열립니다.
echo   관리자 권한 요청(UAC)이 표시되면 [예]를 클릭해주세요.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
    echo.
    echo [WARN] 설치 스크립트가 종료 코드 %EXITCODE% 로 종료되었습니다.
    echo        자세한 내용은 PowerShell 창의 메시지와 로그 파일을 확인하세요.
    echo.
    pause
)

endlocal
exit /b %EXITCODE%
