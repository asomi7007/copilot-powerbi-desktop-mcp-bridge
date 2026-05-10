# Power BI MCP Bridge - configuration script
# Interactive menu to reset / reconfigure the Bridge.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge - Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir

Write-Host "Choose an action:" -ForegroundColor Yellow
Write-Host "  1. Run interactive setup wizard"
Write-Host "  2. Reset configuration to defaults"
Write-Host "  3. Change only the MCP exe path"
Write-Host "  4. Show current configuration"
Write-Host "  q. Cancel"
Write-Host ""

$choice = Read-Host "Selection"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Launching the setup wizard..." -ForegroundColor Cyan
        Write-Host ""
        Push-Location $projectDir
        node dist/index.js --setup
        Pop-Location
    }
    "2" {
        Write-Host ""
        Write-Host "Resetting configuration..." -ForegroundColor Cyan
        Write-Host ""

        $configPath = Join-Path $projectDir "config.yaml"
        $examplePath = Join-Path $projectDir "config.example.yaml"

        # Back up existing config
        if (Test-Path $configPath) {
            $backup = "${configPath}.bak"
            Copy-Item $configPath $backup -Force
            Write-Host "  [Pkg] Backed up existing config to: $backup" -ForegroundColor Gray
        }

        # Copy example to active config
        if (Test-Path $examplePath) {
            Copy-Item $examplePath $configPath -Force
            Write-Host "  [OK] Configuration reset." -ForegroundColor Green
            Write-Host ""
            Write-Host "Restart the server to apply defaults." -ForegroundColor Gray
        } else {
            Write-Host "  [X] Could not find config.example.yaml" -ForegroundColor Red
        }

        Write-Host ""
    }
    "3" {
        Write-Host ""
        Write-Host "Change MCP exe path" -ForegroundColor Cyan
        Write-Host ""

        $mcpPath = Read-Host "  Enter the full path to powerbi-modeling-mcp.exe"

        if ($mcpPath -and (Test-Path $mcpPath)) {
            Write-Host ""
            Write-Host "  Found: $mcpPath" -ForegroundColor Gray
            Write-Host "  Updating config.yaml..." -ForegroundColor Gray
            Write-Host ""

            # Update mcp.command in config.yaml via a tiny Node script
            Push-Location $projectDir

            $updateScript = @"
const yaml = require('yaml');
const fs = require('fs');
const path = require('path');

const configPath = path.join(process.cwd(), 'config.yaml');
const examplePath = path.join(process.cwd(), 'config.example.yaml');

let config = {};

// Load existing config.yaml; otherwise start from the example
if (fs.existsSync(configPath)) {
    config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
} else if (fs.existsSync(examplePath)) {
    config = yaml.parse(fs.readFileSync(examplePath, 'utf8'));
}

if (!config.mcp) config.mcp = {};
config.mcp.command = '$($mcpPath.Replace('\', '\\'))';

fs.writeFileSync(configPath, yaml.stringify(config), 'utf8');
console.log('  [OK] MCP path updated.');
"@

            $updateScript | node
            Pop-Location

            Write-Host ""
        } else {
            Write-Host ""
            Write-Host "  [X] File not found: $mcpPath" -ForegroundColor Red
            Write-Host ""
        }
    }
    "4" {
        Write-Host ""
        Write-Host "Current configuration" -ForegroundColor Cyan
        Write-Host ""

        $configPath = Join-Path $projectDir "config.yaml"

        if (Test-Path $configPath) {
            Write-Host "  config.yaml contents:" -ForegroundColor Gray
            Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray
            Get-Content $configPath | ForEach-Object { Write-Host "  $_" }
            Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray
        } else {
            Write-Host "  No config.yaml found." -ForegroundColor Yellow
            Write-Host "  The defaults from config.example.yaml will be used." -ForegroundColor Gray
        }

        Write-Host ""
    }
    default {
        Write-Host ""
        Write-Host "Cancelled." -ForegroundColor Gray
        Write-Host ""
    }
}

Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
