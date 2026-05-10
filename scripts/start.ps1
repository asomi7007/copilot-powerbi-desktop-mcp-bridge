# Power BI MCP Bridge - start script

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge - Start" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Project root = parent of scripts/
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir

# Verify Power BI Desktop is running
Write-Host "Checking for Power BI Desktop..." -ForegroundColor Cyan
$pbiProcess = Get-Process -Name "PBIDesktop" -ErrorAction SilentlyContinue
if ($pbiProcess) {
    Write-Host "   [OK] Power BI Desktop is running (PID: $($pbiProcess.Id))" -ForegroundColor Green
} else {
    Write-Host "   [!]  Power BI Desktop is not running." -ForegroundColor Yellow
    Write-Host "       Launch Power BI Desktop first, then start the Bridge." -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway? (Y/N)"
    if ($continue -ne "Y" -and $continue -ne "y") {
        exit 1
    }
}

Write-Host ""
Write-Host "Starting the Bridge server..." -ForegroundColor Green
Write-Host "   Location: $projectDir" -ForegroundColor Gray
Write-Host "   Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

Push-Location $projectDir

try {
    # Prefer the pre-built .exe (no Node.js needed); fall back to dist/index.js
    $exePath = Join-Path $projectDir "pbi-mcp-bridge.exe"
    $indexPath = Join-Path $projectDir "dist\index.js"

    if (Test-Path $exePath) {
        & $exePath
    } elseif (Test-Path $indexPath) {
        node dist/index.js
    } else {
        Write-Host "[X] Could not find an executable." -ForegroundColor Red
        Write-Host "    Need either pbi-mcp-bridge.exe or dist/index.js" -ForegroundColor Red
        Write-Host ""
        Write-Host "If you are running from source, build first:" -ForegroundColor Yellow
        Write-Host "   npm install" -ForegroundColor Gray
        Write-Host "   npm run build" -ForegroundColor Gray
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "[X] Failed to start the Bridge: $_" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Bridge stopped." -ForegroundColor Yellow
