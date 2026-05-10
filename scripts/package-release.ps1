<#
.SYNOPSIS
    GitHub Releases 배포용 zip 패키지 생성

.DESCRIPTION
    pkg로 단일 .exe를 빌드하고, 최종 사용자에게 필요한 파일만 모아 zip으로 압축한다.
    결과물은 Node.js 없이 동작하며, 사용자는 zip 풀고 Install.bat만 더블클릭하면 된다.

    zip 내부 구조 (start.ps1이 루트 .exe를 인식하도록 설계):
      pbi-mcp-bridge-win-x64-v{ver}/
        ├── Install.bat               <- 비IT 사용자 진입점
        ├── pbi-mcp-bridge.exe        <- 사전 빌드 (Node.js 내장)
        ├── config.example.yaml
        ├── README.md
        ├── LICENSE
        ├── scripts/
        │     ├── install-all.ps1     <- 사전요구사항 + Bridge 설치
        │     ├── install.ps1
        │     ├── start.ps1
        │     ├── stop.ps1
        │     ├── setup.ps1
        │     └── register-startup.ps1
        ├── connector/
        │     ├── apiDefinition.swagger.json
        │     └── apiProperties.json
        └── samples/
              └── BI-sample.pbix      <- MCP 테스트용 샘플 모델

.PARAMETER OutputDir
    zip 파일 저장 폴더 (기본: 프로젝트 루트의 release\)

.PARAMETER Version
    릴리스 버전. 미지정 시 package.json의 version 사용.

.PARAMETER SkipBuild
    pkg:build 단계 건너뛰기 (이미 release\pbi-mcp-bridge.exe가 있을 때)

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
    # 0. 버전 결정
    # ----------------------------------------------------------------------
    if (-not $Version) {
        $pkgPath = Join-Path $projectRoot 'package.json'
        if (-not (Test-Path $pkgPath)) { throw "package.json 없음: $pkgPath" }
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
    # 1. pkg 빌드
    # ----------------------------------------------------------------------
    $sourceExe = Join-Path $projectRoot 'release\pbi-mcp-bridge.exe'
    if ($SkipBuild) {
        Write-Host "[1/3] pkg 빌드 SKIP (-SkipBuild)" -ForegroundColor Yellow
        if (-not (Test-Path $sourceExe)) {
            throw "기존 빌드 결과물 없음: $sourceExe"
        }
    } else {
        Write-Host "[1/3] pkg 빌드 실행 (npm run pkg:build)..." -ForegroundColor Cyan
        & npm run pkg:build
        if ($LASTEXITCODE -ne 0) { throw "npm run pkg:build 실패 (exit $LASTEXITCODE)" }
        if (-not (Test-Path $sourceExe)) { throw "빌드 결과물 없음: $sourceExe" }
        Write-Host "    [OK] $sourceExe" -ForegroundColor Green
    }

    # ----------------------------------------------------------------------
    # 2. 스테이징 폴더 구성
    # ----------------------------------------------------------------------
    Write-Host "[2/3] 배포 파일 스테이징..." -ForegroundColor Cyan

    $stageName = "pbi-mcp-bridge-win-x64-v$Version"
    $stageRoot = Join-Path $env:TEMP $stageName
    if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $stageRoot | Out-Null

    # zip 루트에 .exe (start.ps1이 이 위치에서 찾음)
    Copy-Item $sourceExe (Join-Path $stageRoot 'pbi-mcp-bridge.exe') -Force
    Write-Host "    [+] pbi-mcp-bridge.exe" -ForegroundColor Gray

    # 루트 단일 파일들 (있는 것만)
    $rootFiles = @('Install.bat', 'config.example.yaml', 'README.md', 'LICENSE')
    foreach ($f in $rootFiles) {
        $src = Join-Path $projectRoot $f
        if (Test-Path $src) {
            Copy-Item $src $stageRoot -Force
            Write-Host "    [+] $f" -ForegroundColor Gray
        } else {
            Write-Host "    [-] $f (없음, 스킵)" -ForegroundColor DarkYellow
        }
    }

    # scripts/ — 단, package-release.ps1 자기 자신은 제외 (배포에 불필요)
    $scriptsStage = Join-Path $stageRoot 'scripts'
    New-Item -ItemType Directory -Path $scriptsStage | Out-Null
    Get-ChildItem -Path (Join-Path $projectRoot 'scripts') -File |
        Where-Object { $_.Name -ne 'package-release.ps1' } |
        ForEach-Object {
            Copy-Item $_.FullName $scriptsStage -Force
            Write-Host "    [+] scripts\$($_.Name)" -ForegroundColor Gray
        }

    # connector/ (Swagger 정의 — Copilot Studio Custom Connector용)
    $connectorSrc = Join-Path $projectRoot 'connector'
    if (Test-Path $connectorSrc) {
        Copy-Item -Recurse $connectorSrc $stageRoot -Force
        Write-Host "    [+] connector\" -ForegroundColor Gray
    }

    # samples/ (MCP 테스트용 샘플 .pbix)
    $samplesSrc = Join-Path $projectRoot 'samples'
    if (Test-Path $samplesSrc) {
        Copy-Item -Recurse $samplesSrc $stageRoot -Force
        $pbixCount = (Get-ChildItem (Join-Path $stageRoot 'samples') -Filter '*.pbix' -ErrorAction SilentlyContinue).Count
        Write-Host "    [+] samples\ ($pbixCount .pbix)" -ForegroundColor Gray
    }

    # 버전 정보 파일
    $versionInfo = @{
        version    = $Version
        builtAt    = (Get-Date -Format 'o')
        builtOn    = $env:COMPUTERNAME
        nodeTarget = 'node18-win-x64'
    } | ConvertTo-Json
    Set-Content -Path (Join-Path $stageRoot 'version.json') -Value $versionInfo -Encoding UTF8
    Write-Host "    [+] version.json" -ForegroundColor Gray

    # ----------------------------------------------------------------------
    # 3. zip 압축
    # ----------------------------------------------------------------------
    Write-Host "[3/3] zip 압축..." -ForegroundColor Cyan

    if (-not (Test-Path $OutputDir)) {
        New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    }
    $zipPath = Join-Path $OutputDir "$stageName.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    # zip 안에 stageName 폴더가 보이도록 (Compress-Archive는 Path를 그대로 보존)
    Compress-Archive -Path $stageRoot -DestinationPath $zipPath -CompressionLevel Optimal

    Remove-Item $stageRoot -Recurse -Force

    $size = (Get-Item $zipPath).Length / 1MB
    Write-Host ""
    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host ("  [OK] {0}" -f $zipPath) -ForegroundColor Green
    Write-Host ("       {0:N2} MB" -f $size) -ForegroundColor Green
    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "다음 단계:" -ForegroundColor Cyan
    Write-Host "  1) GitHub Releases에서 새 릴리스 생성"
    Write-Host "  2) 위 zip을 asset으로 업로드"
    Write-Host "  3) tag = v$Version (install.ps1의 자동 다운로드와 호환)"
    Write-Host ""
}
finally {
    Pop-Location
}
