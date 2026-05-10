<#
.SYNOPSIS
    Power BI MCP Bridge - 사전 요구사항 + 본체 통합 설치 스크립트

.DESCRIPTION
    비IT 전문가도 안전하게 사용할 수 있도록 다음 4가지를 순서대로 점검/설치합니다.

      1) Power BI Desktop          - winget Microsoft.PowerBI
      2) On-premises Data Gateway  - 공식 인스톨러 다운로드 + GUI 마법사
      3) powerbi-modeling-mcp      - VS Code Marketplace VSIX 추출
      4) Bridge 본체               - 기존 install.ps1 호출 (선택)

    보안 원칙:
      - TLS 1.2+ 강제
      - 공식 Microsoft / VS Code Marketplace URL만 사용
      - 다운로드 파일은 Authenticode 디지털 서명 검증 후에만 실행
      - winget 우선 사용 (서명/검증된 패키지)
      - 모든 단계는 사용자 확인 후 진행 (-NonInteractive 시 자동 Y)
      - 모든 작업은 로그 파일에 기록 (사후 검증 가능)

.PARAMETER InstallPath
    Bridge 설치 경로 (기본: C:\pbi-mcp-bridge)

.PARAMETER NonInteractive
    모든 프롬프트를 자동 [Y]로 응답. CI 또는 사일런트 설치용.

.PARAMETER SkipPowerBIDesktop
    Power BI Desktop 단계 건너뛰기

.PARAMETER SkipGateway
    On-premises Data Gateway 단계 건너뛰기

.PARAMETER SkipMcp
    powerbi-modeling-mcp 단계 건너뛰기

.PARAMETER SkipBridge
    Bridge 본체 단계 건너뛰기 (사전 요구사항만 점검)

.EXAMPLE
    .\install-all.ps1
    .\install-all.ps1 -SkipBridge
    .\install-all.ps1 -InstallPath "D:\bridge" -NonInteractive
#>
[CmdletBinding()]
param(
    [string]$InstallPath = "C:\pbi-mcp-bridge",
    [switch]$NonInteractive,
    [switch]$SkipPowerBIDesktop,
    [switch]$SkipGateway,
    [switch]$SkipMcp,
    [switch]$SkipBridge
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ============================================================================
# 글로벌 상태
# ============================================================================
$script:LogFile = Join-Path $env:TEMP ("pbi-mcp-bridge-install-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$script:StepTotal = 4
$script:MicrosoftIssuerHints = @('Microsoft Corporation', 'Microsoft Code Signing')

# 보안: TLS 1.2+ 강제 (구버전 Windows 호환을 위해 OR 연산)
[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ============================================================================
# 출력/로깅 헬퍼
# ============================================================================
function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'HH:mm:ss'), $Level, $Message
    Add-Content -Path $script:LogFile -Value $line -Encoding UTF8
}

function Write-Step {
    param([int]$Number, [string]$Title)
    Write-Host ""
    Write-Host ("[{0}/{1}] {2}" -f $Number, $script:StepTotal, $Title) -ForegroundColor Cyan
    Write-Host ("-" * 60) -ForegroundColor DarkGray
    Write-Log "STEP $Number/$script:StepTotal : $Title" 'STEP'
}

function Write-Ok    { param([string]$m) Write-Host "  [OK]  $m" -ForegroundColor Green;  Write-Log $m 'OK' }
function Write-Info  { param([string]$m) Write-Host "  ..   $m" -ForegroundColor Gray;   Write-Log $m 'INFO' }
function Write-Warn  { param([string]$m) Write-Host "  [!]   $m" -ForegroundColor Yellow; Write-Log $m 'WARN' }
function Write-Err   { param([string]$m) Write-Host "  [X]   $m" -ForegroundColor Red;    Write-Log $m 'ERROR' }

function Read-YesNo {
    param([string]$Prompt, [string]$Default = 'Y')
    if ($NonInteractive) {
        Write-Info "$Prompt -> [auto $Default]"
        return ($Default -eq 'Y')
    }
    while ($true) {
        $hint = if ($Default -eq 'Y') { '[Y/n]' } else { '[y/N]' }
        $r = Read-Host "  $Prompt $hint"
        if ([string]::IsNullOrWhiteSpace($r)) { $r = $Default }
        switch -Regex ($r) {
            '^[Yy]' { return $true }
            '^[Nn]' { return $false }
        }
    }
}

# ============================================================================
# 환경/보안 헬퍼
# ============================================================================
function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Elevate {
    # 자기 자신을 관리자 권한으로 재실행하고 현재 프로세스는 종료
    $argList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`""
    )
    foreach ($k in $PSBoundParameters.Keys) {
        $v = $PSBoundParameters[$k]
        if ($v -is [switch]) {
            if ($v.IsPresent) { $argList += "-$k" }
        } elseif ($null -ne $v) {
            $argList += "-$k"
            $argList += "`"$v`""
        }
    }
    Write-Info "재실행: powershell.exe $($argList -join ' ')"
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs | Out-Null
    exit 0
}

function Test-Authenticode {
    <#
    파일이 Microsoft에 의해 디지털 서명되었는지 확인.
    Status가 Valid이고, 서명자 인증서 주체에 Microsoft가 포함되어야 통과.
    URL 변경에도 안전 (URL 신뢰가 아닌 서명 신뢰 기반).
    #>
    param([string]$FilePath)
    if (-not (Test-Path $FilePath)) { return $false }
    $sig = Get-AuthenticodeSignature -FilePath $FilePath
    Write-Log ("Authenticode: status={0}, subject='{1}'" -f $sig.Status, $sig.SignerCertificate.Subject) 'SIGN'
    if ($sig.Status -ne 'Valid') {
        Write-Warn "디지털 서명 상태가 Valid가 아님: $($sig.Status)"
        return $false
    }
    $subject = $sig.SignerCertificate.Subject
    foreach ($hint in $script:MicrosoftIssuerHints) {
        if ($subject -match [Regex]::Escape($hint)) { return $true }
    }
    Write-Warn "서명자가 Microsoft가 아닌 것으로 보임: $subject"
    return $false
}

function Invoke-WebDownload {
    param([Parameter(Mandatory)][string]$Url, [Parameter(Mandatory)][string]$OutFile)
    Write-Info "다운로드: $Url"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $oldPref = $ProgressPreference
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -MaximumRedirection 10
    } finally {
        $ProgressPreference = $oldPref
    }
    $sw.Stop()
    if (-not (Test-Path $OutFile)) { throw "다운로드 실패: 파일이 생성되지 않음" }
    $size = (Get-Item $OutFile).Length / 1MB
    Write-Info ("저장: {0:N1} MB ({1:N1}s)" -f $size, $sw.Elapsed.TotalSeconds)
}

function Test-Winget {
    return [bool](Get-Command winget -ErrorAction SilentlyContinue)
}

function Invoke-Winget {
    param([Parameter(Mandatory)][string]$Id, [string]$Name = $Id)
    Write-Info "winget install --exact --id $Id"
    $output = & winget install --exact --id $Id --silent `
        --accept-package-agreements --accept-source-agreements 2>&1
    $code = $LASTEXITCODE
    Write-Log ("winget exit=$code output=$($output | Out-String)") 'WINGET'
    # winget exit codes: 0 = success, 0x8A150006 = no applicable upgrade (이미 최신)
    if ($code -ne 0 -and $code -ne 0x8A150006) {
        throw "winget 설치 실패 ($Name): exit $code"
    }
}

# ============================================================================
# [1] Power BI Desktop
# ============================================================================
function Test-PowerBIDesktop {
    $candidates = @(
        "$env:ProgramFiles\Microsoft Power BI Desktop\bin\PBIDesktop.exe",
        "${env:ProgramFiles(x86)}\Microsoft Power BI Desktop\bin\PBIDesktop.exe"
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) {
            return [PSCustomObject]@{ Found = $true; Path = $p; Source = 'MSI' }
        }
    }
    # Microsoft Store 버전
    try {
        $appx = Get-AppxPackage -Name 'Microsoft.MicrosoftPowerBIDesktop' -ErrorAction SilentlyContinue
        if ($appx) {
            return [PSCustomObject]@{ Found = $true; Path = $appx.InstallLocation; Source = 'Store' }
        }
    } catch { }
    return [PSCustomObject]@{ Found = $false }
}

function Install-PowerBIDesktop {
    if (-not (Test-Winget)) {
        Write-Warn "winget이 설치되어 있지 않습니다. 수동 설치가 필요합니다."
        Write-Host "    공식 다운로드: https://powerbi.microsoft.com/desktop/" -ForegroundColor White
        if (Read-YesNo "다운로드 페이지를 브라우저에서 여시겠습니까?" 'Y') {
            Start-Process 'https://powerbi.microsoft.com/desktop/'
        }
        throw "Power BI Desktop 자동 설치 불가 (winget 미설치)"
    }
    Invoke-Winget -Id 'Microsoft.PowerBI' -Name 'Power BI Desktop'
}

function Step-PowerBIDesktop {
    Write-Step 1 "Power BI Desktop"
    $r = Test-PowerBIDesktop
    if ($r.Found) {
        Write-Ok ("이미 설치됨: {0}  [{1}]" -f $r.Path, $r.Source)
        return
    }
    Write-Warn "Power BI Desktop이 설치되어 있지 않습니다."
    Write-Host "    Bridge가 데이터를 읽으려면 Power BI Desktop이 필요합니다." -ForegroundColor Gray
    if (-not (Read-YesNo "지금 설치하시겠습니까? (winget, 약 2~5분)" 'Y')) {
        Write-Warn "Power BI Desktop 설치를 건너뜁니다. 나중에 직접 설치해야 합니다."
        return
    }
    Install-PowerBIDesktop
    $r2 = Test-PowerBIDesktop
    if ($r2.Found) {
        Write-Ok "설치 완료: $($r2.Path)"
    } else {
        Write-Warn "설치 직후 검증 실패. winget 출력을 로그에서 확인하세요."
    }
}

# ============================================================================
# [2] On-premises Data Gateway
# ============================================================================
function Test-DataGateway {
    # 표준 모드와 개인 모드의 서비스 이름이 다를 수 있어 모두 확인
    $svcCandidates = @('PBIEgwService', 'OnPremisesDataGatewayService', 'PowerBIPersonalGateway')
    foreach ($n in $svcCandidates) {
        $svc = Get-Service -Name $n -ErrorAction SilentlyContinue
        if ($svc) { return [PSCustomObject]@{ Found = $true; Service = $n; Status = $svc.Status } }
    }
    $dirCandidates = @(
        "$env:ProgramFiles\On-premises data gateway",
        "$env:ProgramFiles\Microsoft On-Premises Data Gateway"
    )
    foreach ($d in $dirCandidates) {
        if (Test-Path $d) { return [PSCustomObject]@{ Found = $true; Path = $d; Service = $null } }
    }
    return [PSCustomObject]@{ Found = $false }
}

function Install-DataGateway {
    # 공식 Microsoft Download Center 인스톨러.
    # URL 변경에 대비해 Authenticode 서명 검증으로 무결성 보장.
    $urls = @(
        'https://aka.ms/OnPremisesDataGatewayStandardInstaller',
        'https://download.microsoft.com/download/D/A/1/DA1FDDB8-6DA8-4F50-B4D0-18019591E182/GatewayInstall.exe'
    )
    $tmp = Join-Path $env:TEMP "GatewayInstall.exe"

    $downloaded = $false
    foreach ($u in $urls) {
        try {
            Invoke-WebDownload -Url $u -OutFile $tmp
            $downloaded = $true
            break
        } catch {
            Write-Warn "다운로드 실패 ($u): $_"
        }
    }
    if (-not $downloaded) {
        Write-Host "    수동 다운로드: https://powerbi.microsoft.com/gateway/" -ForegroundColor White
        if (Read-YesNo "다운로드 페이지를 브라우저에서 여시겠습니까?" 'Y') {
            Start-Process 'https://powerbi.microsoft.com/gateway/'
        }
        throw "Gateway 자동 다운로드 실패"
    }

    if (-not (Test-Authenticode -FilePath $tmp)) {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        throw "Gateway 인스톨러의 Microsoft 디지털 서명 검증 실패. 보안상 중단합니다."
    }
    Write-Ok "디지털 서명 검증 통과 (Microsoft Corporation)"

    Write-Host ""
    Write-Host "    -----------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "    Gateway 설치 마법사가 실행됩니다." -ForegroundColor Yellow
    Write-Host "    1) 약관 동의 후 [설치]" -ForegroundColor White
    Write-Host "    2) Microsoft 계정으로 로그인 (Power BI 라이선스 보유 계정)" -ForegroundColor White
    Write-Host "    3) [이 컴퓨터에 새 게이트웨이 등록] 선택" -ForegroundColor White
    Write-Host "    4) Gateway 이름 지정 + 복구 키 설정/백업" -ForegroundColor White
    Write-Host "    -----------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    if (-not (Read-YesNo "준비되셨으면 마법사를 시작합니다." 'Y')) {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        Write-Warn "사용자가 Gateway 설치를 취소함"
        return
    }
    Start-Process -FilePath $tmp -Wait
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

function Step-DataGateway {
    Write-Step 2 "On-premises Data Gateway"
    $r = Test-DataGateway
    if ($r.Found) {
        if ($r.Service) {
            Write-Ok ("이미 설치됨: 서비스 '{0}' (상태 {1})" -f $r.Service, $r.Status)
        } else {
            Write-Ok ("이미 설치됨: $($r.Path)")
        }
        return
    }
    Write-Warn "On-premises Data Gateway가 설치되어 있지 않습니다."
    Write-Host "    이 게이트웨이는 Copilot Studio가 로컬 PC의 Bridge로" -ForegroundColor Gray
    Write-Host "    안전하게 연결되도록 하는 Microsoft 공식 컴포넌트입니다." -ForegroundColor Gray
    Write-Host "    설치 후 Microsoft 계정 로그인 + 게이트웨이 등록이 필요합니다." -ForegroundColor Gray
    if (-not (Read-YesNo "지금 다운로드 후 설치 마법사를 실행하시겠습니까?" 'Y')) {
        Write-Warn "Gateway 설치를 건너뜁니다. Copilot 연결 시 필요합니다."
        return
    }
    Install-DataGateway
    $r2 = Test-DataGateway
    if ($r2.Found) { Write-Ok "Gateway 설치 확인 완료" }
    else { Write-Warn "설치 직후 서비스 미감지. 마법사를 끝까지 진행했는지 확인하세요." }
}

# ============================================================================
# [3] powerbi-modeling-mcp (MCP 서버)
# ============================================================================
function Test-PowerBIMcp {
    $vscodeDirs = @(
        Join-Path $env:USERPROFILE '.vscode\extensions',
        Join-Path $env:USERPROFILE '.vscode-insiders\extensions'
    )
    foreach ($base in $vscodeDirs) {
        if (-not (Test-Path $base)) { continue }
        $exts = Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like 'analysis-services.powerbi-modeling-mcp-*' } |
            Sort-Object Name -Descending
        foreach ($e in $exts) {
            $exe = Join-Path $e.FullName 'server\powerbi-modeling-mcp.exe'
            if (Test-Path $exe) {
                return [PSCustomObject]@{ Found = $true; Path = $exe; Source = $e.Name }
            }
        }
    }
    return [PSCustomObject]@{ Found = $false }
}

function Install-PowerBIMcp {
    # VS Code Marketplace의 공식 VSIX 패키지 (= ZIP 형식).
    # ~/.vscode/extensions에 추출하면 Bridge의 mcp-discovery가 자동 인식.
    $vsixUrl = 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/analysis-services/vsextensions/powerbi-modeling-mcp/latest/vspackage?targetPlatform=win32-x64'
    $vsixTmp = Join-Path $env:TEMP 'powerbi-modeling-mcp.vsix'
    $extractRoot = Join-Path $env:TEMP ("pbi-mcp-extract-" + [Guid]::NewGuid().ToString('N'))

    Invoke-WebDownload -Url $vsixUrl -OutFile $vsixTmp

    if ((Get-Item $vsixTmp).Length -lt 100KB) {
        Remove-Item $vsixTmp -Force -ErrorAction SilentlyContinue
        throw "VSIX 다운로드 결과가 너무 작습니다. URL이 변경되었을 수 있습니다."
    }

    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    Expand-Archive -Path $vsixTmp -DestinationPath $extractRoot -Force

    $extensionRoot = Join-Path $extractRoot 'extension'
    if (-not (Test-Path $extensionRoot)) {
        Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
        throw "VSIX 구조 비정상: 'extension' 폴더가 없습니다."
    }

    # package.json에서 버전 추출 (폴더명에 사용하면 Bridge 자동 탐색이 최신 우선 정렬 가능)
    $version = '0.0.0'
    $pkgJsonPath = Join-Path $extensionRoot 'package.json'
    if (Test-Path $pkgJsonPath) {
        try {
            $pkg = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
            if ($pkg.version) { $version = $pkg.version }
        } catch {
            Write-Warn "package.json 파싱 실패. 기본 버전 사용: $version"
        }
    }

    # MCP 실행파일 서명 확인 (정보성 — VS Code Marketplace 출처 자체가 신뢰 경로)
    $mcpExe = Join-Path $extensionRoot 'server\powerbi-modeling-mcp.exe'
    if (-not (Test-Path $mcpExe)) {
        Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
        throw "VSIX에서 MCP 실행파일을 찾지 못함: server\powerbi-modeling-mcp.exe"
    }
    $sig = Get-AuthenticodeSignature -FilePath $mcpExe
    if ($sig.Status -eq 'Valid') {
        Write-Ok "MCP 실행파일 서명 확인: $($sig.SignerCertificate.Subject)"
    } else {
        Write-Warn "MCP 실행파일 미서명 또는 미검증 (status=$($sig.Status)). VS Code Marketplace 출처이므로 진행합니다."
    }

    # ~/.vscode/extensions/analysis-services.powerbi-modeling-mcp-{version}로 이동
    $targetParent = Join-Path $env:USERPROFILE '.vscode\extensions'
    $targetDir = Join-Path $targetParent ("analysis-services.powerbi-modeling-mcp-$version")
    if (-not (Test-Path $targetParent)) {
        New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
    }
    if (Test-Path $targetDir) {
        Write-Info "기존 설치 갱신: $targetDir"
        Remove-Item $targetDir -Recurse -Force
    }
    Move-Item -Path $extensionRoot -Destination $targetDir -Force

    Remove-Item $vsixTmp -Force -ErrorAction SilentlyContinue
    Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue

    Write-Ok "설치 위치: $targetDir"
}

function Step-PowerBIMcp {
    Write-Step 3 "powerbi-modeling-mcp (MCP 서버)"
    $r = Test-PowerBIMcp
    if ($r.Found) {
        Write-Ok ("이미 설치됨: $($r.Path)")
        Write-Info "버전 폴더: $($r.Source)"
        return
    }
    Write-Warn "powerbi-modeling-mcp가 설치되어 있지 않습니다."
    Write-Host "    VS Code Marketplace의 공식 패키지" -ForegroundColor Gray
    Write-Host "    (analysis-services.powerbi-modeling-mcp)를 다운로드합니다." -ForegroundColor Gray
    if (-not (Read-YesNo "지금 설치하시겠습니까? (약 30~60초)" 'Y')) {
        Write-Warn "MCP 설치를 건너뜁니다. Bridge 시작 시 자동 다운로드를 시도합니다."
        return
    }
    Install-PowerBIMcp
    $r2 = Test-PowerBIMcp
    if ($r2.Found) { Write-Ok "검증 완료: $($r2.Path)" }
    else { throw "설치 직후 MCP 실행파일 검증 실패" }
}

# ============================================================================
# [4] Bridge 본체
# ============================================================================
function New-DesktopShortcut {
    param([Parameter(Mandatory)][string]$ProjectRoot)
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop 'Power BI MCP Bridge.lnk'
    $startScript = Join-Path $ProjectRoot 'scripts\start.ps1'
    if (-not (Test-Path $startScript)) {
        Write-Warn "start.ps1 없음 - 바로가기 생성 건너뜀: $startScript"
        return
    }
    try {
        $sh = New-Object -ComObject WScript.Shell
        $sc = $sh.CreateShortcut($shortcutPath)
        $sc.TargetPath = 'powershell.exe'
        $sc.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$startScript`""
        $sc.WorkingDirectory = $ProjectRoot
        $sc.IconLocation = 'powershell.exe,0'
        $sc.Description = 'Power BI MCP Bridge 시작'
        $sc.Save()
        Write-Ok "바탕화면 바로가기: $shortcutPath"
    } catch {
        Write-Warn "바로가기 생성 실패: $_"
    }
}

function Initialize-LocalBridge {
    <#
    배포 zip을 그 자리에서 사용 (run-in-place).
    config.yaml 생성 + 선택적으로 바탕화면 바로가기.
    #>
    param([Parameter(Mandatory)][string]$ProjectRoot)

    $configExample = Join-Path $ProjectRoot 'config.example.yaml'
    $config        = Join-Path $ProjectRoot 'config.yaml'
    if (-not (Test-Path $config) -and (Test-Path $configExample)) {
        Copy-Item $configExample $config
        Write-Ok "config.yaml 생성: $config"
    } elseif (Test-Path $config) {
        Write-Info "기존 config.yaml 보존: $config"
    }

    # filesystem 도구 샌드박스 폴더 자동 생성 (config의 allowedPaths가 비어있어도
    # Bridge 시작 시 같은 위치를 만들지만, 사용자에게 폴더 위치를 미리 보여주기 위함).
    $workspace = Join-Path $ProjectRoot 'workspace'
    if (-not (Test-Path $workspace)) {
        New-Item -ItemType Directory -Path $workspace -Force | Out-Null
        Write-Ok "filesystem 샌드박스 생성: $workspace"
    } else {
        Write-Info "filesystem 샌드박스 존재: $workspace"
    }

    if (Read-YesNo "바탕화면에 시작 바로가기를 만들까요?" 'Y') {
        New-DesktopShortcut -ProjectRoot $ProjectRoot
    }

    Write-Host ""
    Write-Host "    Bridge 위치: $ProjectRoot" -ForegroundColor Gray
    Write-Host "    시작:        .\scripts\start.ps1" -ForegroundColor Gray
}

function Step-Bridge {
    Write-Step 4 "Power BI MCP Bridge (본체)"

    # install-all.ps1은 scripts\ 안에 있으므로 한 단계 위가 프로젝트 루트
    $projectRoot = Split-Path $PSScriptRoot -Parent

    # === 1순위: 배포 zip 레이아웃 — 루트에 사전 빌드 .exe ===
    $localExeRoot = Join-Path $projectRoot 'pbi-mcp-bridge.exe'
    if (Test-Path $localExeRoot) {
        Write-Ok "사전 빌드 .exe 발견: $localExeRoot"
        Write-Info "Node.js 불필요. 현재 폴더를 설치 위치로 사용합니다."
        Initialize-LocalBridge -ProjectRoot $projectRoot
        return
    }

    # === 2순위: 개발 레이아웃 — release\ 안에 사전 빌드 .exe ===
    $localExeSub = Join-Path $projectRoot 'release\pbi-mcp-bridge.exe'
    if (Test-Path $localExeSub) {
        Write-Info "release\pbi-mcp-bridge.exe 발견. 프로젝트 루트로 복사합니다 (start.ps1 호환)"
        Copy-Item $localExeSub $localExeRoot -Force
        Write-Ok "복사 완료: $localExeRoot"
        Initialize-LocalBridge -ProjectRoot $projectRoot
        return
    }

    # === 3순위: 소스 빌드 결과물 — dist\index.js (Node.js 필요) ===
    if (Test-Path (Join-Path $projectRoot 'dist\index.js')) {
        Write-Warn "사전 빌드 .exe 없음. dist\index.js 사용 - Node.js 런타임 필요"
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            Write-Warn "Node.js가 설치되어 있지 않습니다. dist\index.js를 실행하려면 Node.js 20+가 필요합니다."
        }
        Initialize-LocalBridge -ProjectRoot $projectRoot
        return
    }

    # === 4순위: 폴백 — 기존 install.ps1 (원격 다운로드 또는 소스 빌드) ===
    Write-Info "로컬 빌드 결과물 없음. 원격 설치(install.ps1)로 폴백합니다."
    $existingInstaller = Join-Path $PSScriptRoot 'install.ps1'
    if (-not (Test-Path $existingInstaller)) {
        Write-Warn "install.ps1 없음 ($existingInstaller). Bridge 단계 건너뜀."
        return
    }
    & $existingInstaller -InstallPath $InstallPath -CreateDesktopShortcut
}

# ============================================================================
# 메인
# ============================================================================
Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge - 통합 설치 마법사" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  로그: $script:LogFile" -ForegroundColor DarkGray
Write-Host ""
Write-Log ("Start: User=$env:USERNAME, OS=$([System.Environment]::OSVersion.VersionString), PSVer=$($PSVersionTable.PSVersion)") 'BOOT'

# 관리자 권한 점검 + 자동 승격
if (-not (Test-IsAdmin)) {
    Write-Warn "관리자 권한이 필요합니다. UAC 프롬프트로 재실행합니다..."
    Start-Sleep -Seconds 1
    Invoke-Elevate
}
Write-Ok "관리자 권한 확인"

# Windows 버전
$os = [System.Environment]::OSVersion.Version
if ($os.Major -lt 10) {
    Write-Err "Windows 10 이상이 필요합니다. (현재: $os)"
    exit 1
}
Write-Ok ("Windows {0}.{1} 확인" -f $os.Major, $os.Minor)

# 실행 정책
$ep = Get-ExecutionPolicy -Scope CurrentUser
if ($ep -eq 'Restricted' -or $ep -eq 'AllSigned') {
    Write-Warn "현재 실행 정책: $ep"
    if (Read-YesNo "RemoteSigned로 변경하시겠습니까? (현재 사용자 한정)" 'Y') {
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
        Write-Ok "실행 정책 변경 완료"
    }
}

# 단계 실행
try {
    if ($SkipPowerBIDesktop) { Write-Step 1 "Power BI Desktop (스킵)" } else { Step-PowerBIDesktop }
    if ($SkipGateway)        { Write-Step 2 "Gateway (스킵)" }            else { Step-DataGateway }
    if ($SkipMcp)            { Write-Step 3 "MCP (스킵)" }                else { Step-PowerBIMcp }
    if ($SkipBridge)         { Write-Step 4 "Bridge (스킵)" }             else { Step-Bridge }
}
catch {
    Write-Host ""
    Write-Err "설치 중 오류: $_"
    Write-Log ($_ | Out-String) 'FATAL'
    Write-Host "    상세 로그: $script:LogFile" -ForegroundColor Yellow
    if (-not $NonInteractive) {
        Write-Host ""
        Read-Host "엔터를 눌러 종료"
    }
    exit 1
}

# 완료 안내
Write-Host ""
Write-Host "=========================================================" -ForegroundColor Green
Write-Host "  설치 완료!" -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Green
Write-Host ""
$bridgeRoot = Split-Path $PSScriptRoot -Parent
$samplePbix = Join-Path $bridgeRoot 'samples\BI-sample.pbix'
Write-Host "다음 단계:" -ForegroundColor Cyan
Write-Host "  1) Power BI Desktop 실행 후 .pbix 파일을 엽니다"
if (Test-Path $samplePbix) {
    Write-Host "       테스트용 샘플: $samplePbix" -ForegroundColor DarkGray
}
Write-Host "  2) Bridge 시작 (또는 바탕화면 바로가기 더블클릭):" -ForegroundColor White
Write-Host "       cd `"$bridgeRoot`"" -ForegroundColor DarkGray
Write-Host "       .\scripts\start.ps1" -ForegroundColor DarkGray
Write-Host "  3) http://localhost:5050/health 에서 상태 확인"
$workspaceHint = Join-Path $bridgeRoot 'workspace'
if (Test-Path $workspaceHint) {
    Write-Host ""
    Write-Host "  파일 조작 MCP (filesystem) 샌드박스:" -ForegroundColor Cyan
    Write-Host "    $workspaceHint" -ForegroundColor DarkGray
    Write-Host "    Copilot Studio가 이 폴더 안에서만 read_file / write_file / list_directory 등을 수행합니다." -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  로그: $script:LogFile" -ForegroundColor DarkGray
Write-Host ""

if (-not $NonInteractive) {
    Read-Host "엔터를 눌러 종료"
}
