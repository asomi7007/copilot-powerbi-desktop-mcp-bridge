<#
.SYNOPSIS
    Build the GitHub Releases distribution zip.

.DESCRIPTION
    Builds a single self-contained .exe with pkg, then stages only the files
    end users need and packs them into a zip. The result runs without Node.js;
    end users only have to extract the zip and double-click Install.bat.

    Zip layout (start.ps1 expects the .exe at the root):
      pbi-mcp-bridge-win-x64-v{ver}/
        |- Install.bat               <- double-click entry point
        |- pbi-mcp-bridge.exe        <- pre-built (Node.js bundled)
        |- config.example.yaml
        |- README.md
        |- LICENSE
        |- scripts/
        |    |- install-all.ps1      <- prerequisites + Bridge installer
        |    |- install.ps1
        |    |- start.ps1
        |    |- stop.ps1
        |    |- setup.ps1
        |    \- register-startup.ps1
        |- connector/
        |    |- apiDefinition.swagger.json
        |    \- apiProperties.json
        \- samples/
             \- BI-sample.pbix       <- MCP smoke-test model

.PARAMETER OutputDir
    Folder to write the zip into (default: <project>\release)

.PARAMETER Version
    Release version. Defaults to package.json's "version".

.PARAMETER SkipBuild
    Skip pkg:build (use the existing release\pbi-mcp-bridge.exe).

.EXAMPLE
    .\scripts\package-release.ps1
    .\scripts\package-release.ps1 -Version 1.0.0
    .\scripts\package-release.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$Version,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $OutputDir) { $OutputDir = Join-Path $projectRoot 'release' }

Push-Location $projectRoot
try {
    # ----------------------------------------------------------------------
    # 0. Determine version
    # ----------------------------------------------------------------------
    if (-not $Version) {
        $pkgPath = Join-Path $projectRoot 'package.json'
        if (-not (Test-Path $pkgPath)) { throw "package.json not found: $pkgPath" }
        $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
        $Version = $pkg.version
    }
    Write-Host ""
    Write-Host "=========================================================" -ForegroundColor Cyan
    Write-Host "  Power BI MCP Bridge - Release Packager" -ForegroundColor Cyan
    Write-Host "=========================================================" -ForegroundColor Cyan
    Write-Host "  Version : $Version" -ForegroundColor White
    Write-Host "  Output  : $OutputDir" -ForegroundColor White
    Write-Host ""

    # ----------------------------------------------------------------------
    # 1. pkg build
    # ----------------------------------------------------------------------
    $sourceExe = Join-Path $projectRoot 'release\pbi-mcp-bridge.exe'
    if ($SkipBuild) {
        Write-Host "[1/3] pkg build SKIPPED (-SkipBuild)" -ForegroundColor Yellow
        if (-not (Test-Path $sourceExe)) {
            throw "No pre-built artifact found at: $sourceExe"
        }
    } else {
        Write-Host "[1/3] pkg build (npm run pkg:build)..." -ForegroundColor Cyan
        & npm run pkg:build
        if ($LASTEXITCODE -ne 0) { throw "npm run pkg:build failed (exit $LASTEXITCODE)" }
        if (-not (Test-Path $sourceExe)) { throw "No build artifact at: $sourceExe" }
        Write-Host "    [OK] $sourceExe" -ForegroundColor Green
    }

    # ----------------------------------------------------------------------
    # 2. Stage release files
    # ----------------------------------------------------------------------
    Write-Host "[2/3] Staging release files..." -ForegroundColor Cyan

    $stageName = "pbi-mcp-bridge-win-x64-v$Version"
    $stageRoot = Join-Path $env:TEMP $stageName
    if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $stageRoot | Out-Null

    # .exe goes at the root so start.ps1 can find it without a subfolder
    Copy-Item $sourceExe (Join-Path $stageRoot 'pbi-mcp-bridge.exe') -Force
    Write-Host "    [+] pbi-mcp-bridge.exe" -ForegroundColor Gray

    # Single root files (only if present)
    $rootFiles = @('Install.bat', 'config.example.yaml', 'README.md', 'LICENSE')
    foreach ($f in $rootFiles) {
        $src = Join-Path $projectRoot $f
        if (Test-Path $src) {
            Copy-Item $src $stageRoot -Force
            Write-Host "    [+] $f" -ForegroundColor Gray
        } else {
            Write-Host "    [-] $f (missing, skipped)" -ForegroundColor DarkYellow
        }
    }

    # scripts/ - exclude package-release.ps1 itself (build-time only)
    $scriptsStage = Join-Path $stageRoot 'scripts'
    New-Item -ItemType Directory -Path $scriptsStage | Out-Null
    Get-ChildItem -Path (Join-Path $projectRoot 'scripts') -File |
        Where-Object { $_.Name -ne 'package-release.ps1' } |
        ForEach-Object {
            Copy-Item $_.FullName $scriptsStage -Force
            Write-Host "    [+] scripts\$($_.Name)" -ForegroundColor Gray
        }

    # connector/ (Swagger for Copilot Studio Custom Connector)
    $connectorSrc = Join-Path $projectRoot 'connector'
    if (Test-Path $connectorSrc) {
        Copy-Item -Recurse $connectorSrc $stageRoot -Force
        Write-Host "    [+] connector\" -ForegroundColor Gray
    }

    # samples/ (MCP smoke-test .pbix)
    $samplesSrc = Join-Path $projectRoot 'samples'
    if (Test-Path $samplesSrc) {
        Copy-Item -Recurse $samplesSrc $stageRoot -Force
        $pbixCount = (Get-ChildItem (Join-Path $stageRoot 'samples') -Filter '*.pbix' -ErrorAction SilentlyContinue).Count
        Write-Host "    [+] samples\ ($pbixCount .pbix)" -ForegroundColor Gray
    }

    # version.json
    $versionInfo = @{
        version    = $Version
        builtAt    = (Get-Date -Format 'o')
        builtOn    = $env:COMPUTERNAME
        nodeTarget = 'node18-win-x64'
    } | ConvertTo-Json
    Set-Content -Path (Join-Path $stageRoot 'version.json') -Value $versionInfo -Encoding UTF8
    Write-Host "    [+] version.json" -ForegroundColor Gray

    # ----------------------------------------------------------------------
    # 3. Zip
    # ----------------------------------------------------------------------
    Write-Host "[3/3] Zipping..." -ForegroundColor Cyan

    if (-not (Test-Path $OutputDir)) {
        New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    }
    $zipPath = Join-Path $OutputDir "$stageName.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    # Pass the staging directory itself so the zip preserves the top-level folder
    Compress-Archive -Path $stageRoot -DestinationPath $zipPath -CompressionLevel Optimal

    Remove-Item $stageRoot -Recurse -Force

    $size = (Get-Item $zipPath).Length / 1MB
    Write-Host ""
    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host ("  [OK] {0}" -f $zipPath) -ForegroundColor Green
    Write-Host ("       {0:N2} MB" -f $size) -ForegroundColor Green
    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1) Create a new release on GitHub"
    Write-Host "  2) Upload the zip above as the release asset"
    Write-Host "  3) Tag = v$Version (matches install.ps1's auto-download)"
    Write-Host ""
}
finally {
    Pop-Location
}
