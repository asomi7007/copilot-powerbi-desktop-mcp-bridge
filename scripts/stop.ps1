# Power BI MCP Bridge 중지 스크립트

# UTF-8 출력 설정
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge 중지" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "🔍 실행 중인 Bridge 프로세스 검색 중..." -ForegroundColor Cyan

# node 프로세스 중 index.js를 실행하는 프로세스 찾기
$nodeProcesses = Get-WmiObject Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -like "*index.js*"
}

# exe 프로세스 찾기
$exeProcesses = Get-Process -Name "pbi-mcp-bridge" -ErrorAction SilentlyContinue

$foundProcesses = @()
if ($nodeProcesses) {
    $foundProcesses += $nodeProcesses
}
if ($exeProcesses) {
    $foundProcesses += $exeProcesses
}

if ($foundProcesses.Count -eq 0) {
    Write-Host "   ℹ️  실행 중인 Bridge 프로세스가 없습니다." -ForegroundColor Yellow
    exit 0
}

Write-Host "   발견된 프로세스: $($foundProcesses.Count)개" -ForegroundColor Green
Write-Host ""

# 각 프로세스 종료
foreach ($process in $foundProcesses) {
    $processId = if ($process.ProcessId) { $process.ProcessId } else { $process.Id }
    $name = if ($process.Name) { $process.Name } else { "node.exe" }
    
    Write-Host "🛑 프로세스 종료 중: $name (PID: $processId)" -ForegroundColor Yellow
    
    try {
        Stop-Process -Id $processId -Force -ErrorAction Stop
        Write-Host "   ✅ 종료 완료" -ForegroundColor Green
    } catch {
        Write-Host "   ⚠️  종료 실패: $_" -ForegroundColor Red
    }
}

# MCP 하위 프로세스도 정리
Write-Host ""
Write-Host "🔍 MCP 하위 프로세스 확인 중..." -ForegroundColor Cyan
$mcpProcesses = Get-Process -Name "powerbi-modeling-mcp" -ErrorAction SilentlyContinue
if ($mcpProcesses) {
    foreach ($mcpProc in $mcpProcesses) {
        Write-Host "   정리 중: powerbi-modeling-mcp.exe (PID: $($mcpProc.Id))" -ForegroundColor Yellow
        try {
            Stop-Process -Id $mcpProc.Id -Force -ErrorAction Stop
            Write-Host "   ✅ 정리 완료" -ForegroundColor Green
        } catch {
            Write-Host "   ⚠️  정리 실패: $_" -ForegroundColor Red
        }
    }
} else {
    Write-Host "   MCP 프로세스 없음" -ForegroundColor Gray
}

Write-Host ""
Write-Host "✅ Bridge 중지 완료" -ForegroundColor Green
Write-Host ""
