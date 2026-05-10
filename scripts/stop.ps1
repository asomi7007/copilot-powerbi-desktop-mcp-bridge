# Power BI MCP Bridge - stop script

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge - Stop" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Looking for running Bridge processes..." -ForegroundColor Cyan

# node.exe processes running index.js
$nodeProcesses = Get-WmiObject Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -like "*index.js*"
}

# Pre-built .exe
$exeProcesses = Get-Process -Name "pbi-mcp-bridge" -ErrorAction SilentlyContinue

$foundProcesses = @()
if ($nodeProcesses) { $foundProcesses += $nodeProcesses }
if ($exeProcesses)  { $foundProcesses += $exeProcesses }

if ($foundProcesses.Count -eq 0) {
    Write-Host "   [i] No Bridge processes are running." -ForegroundColor Yellow
    exit 0
}

Write-Host "   Found $($foundProcesses.Count) process(es)" -ForegroundColor Green
Write-Host ""

# Stop each process
foreach ($process in $foundProcesses) {
    $processId = if ($process.ProcessId) { $process.ProcessId } else { $process.Id }
    $name = if ($process.Name) { $process.Name } else { "node.exe" }

    Write-Host "Stopping: $name (PID: $processId)" -ForegroundColor Yellow

    try {
        Stop-Process -Id $processId -Force -ErrorAction Stop
        Write-Host "   [OK] Stopped" -ForegroundColor Green
    } catch {
        Write-Host "   [!]  Failed: $_" -ForegroundColor Red
    }
}

# Clean up the MCP child process if it survived
Write-Host ""
Write-Host "Looking for orphan MCP child processes..." -ForegroundColor Cyan
$mcpProcesses = Get-Process -Name "powerbi-modeling-mcp" -ErrorAction SilentlyContinue
if ($mcpProcesses) {
    foreach ($mcpProc in $mcpProcesses) {
        Write-Host "   Stopping: powerbi-modeling-mcp.exe (PID: $($mcpProc.Id))" -ForegroundColor Yellow
        try {
            Stop-Process -Id $mcpProc.Id -Force -ErrorAction Stop
            Write-Host "   [OK] Stopped" -ForegroundColor Green
        } catch {
            Write-Host "   [!]  Failed: $_" -ForegroundColor Red
        }
    }
} else {
    Write-Host "   No MCP child processes." -ForegroundColor Gray
}

Write-Host ""
Write-Host "[OK] Bridge shutdown complete" -ForegroundColor Green
Write-Host ""
