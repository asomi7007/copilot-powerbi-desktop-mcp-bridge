# Power BI MCP Bridge 시작 스크립트

# UTF-8 출력 설정
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge 시작" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 스크립트 디렉토리 기준으로 프로젝트 루트 찾기
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir

# Power BI Desktop 실행 확인
Write-Host "🔍 Power BI Desktop 실행 확인 중..." -ForegroundColor Cyan
$pbiProcess = Get-Process -Name "PBIDesktop" -ErrorAction SilentlyContinue
if ($pbiProcess) {
    Write-Host "   ✅ Power BI Desktop이 실행 중입니다 (PID: $($pbiProcess.Id))" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Power BI Desktop이 실행되지 않았습니다." -ForegroundColor Yellow
    Write-Host "   Power BI Desktop을 먼저 실행한 후 Bridge를 시작하세요." -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "그래도 계속하시겠습니까? (Y/N)"
    if ($continue -ne "Y" -and $continue -ne "y") {
        exit 1
    }
}

Write-Host ""
Write-Host "🚀 Bridge 서버를 시작합니다..." -ForegroundColor Green
Write-Host "   위치: $projectDir" -ForegroundColor Gray
Write-Host "   종료하려면 Ctrl+C를 누르세요" -ForegroundColor Gray
Write-Host ""

# 프로젝트 디렉토리로 이동
Push-Location $projectDir

try {
    # dist/index.js 존재 확인
    $indexPath = Join-Path $projectDir "dist\index.js"
    if (Test-Path $indexPath) {
        # 빌드된 버전 실행
        node dist/index.js
    } else {
        # exe 파일 확인
        $exePath = Join-Path $projectDir "pbi-mcp-bridge.exe"
        if (Test-Path $exePath) {
            & $exePath
        } else {
            Write-Host "❌ 실행 파일을 찾을 수 없습니다." -ForegroundColor Red
            Write-Host "   dist/index.js 또는 pbi-mcp-bridge.exe가 필요합니다." -ForegroundColor Red
            Write-Host ""
            Write-Host "빌드되지 않은 경우 다음을 실행하세요:" -ForegroundColor Yellow
            Write-Host "   npm install" -ForegroundColor Gray
            Write-Host "   npm run build" -ForegroundColor Gray
            exit 1
        }
    }
} catch {
    Write-Host ""
    Write-Host "❌ Bridge 시작 실패: $_" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Bridge가 종료되었습니다." -ForegroundColor Yellow
