# Power BI MCP Bridge 설치 스크립트
# 비개발자가 쉽게 실행할 수 있는 원클릭 설치 프로그램

param(
    [string]$InstallPath = "C:\pbi-mcp-bridge",
    [switch]$SkipNodeCheck,
    [switch]$CreateDesktopShortcut
)

# UTF-8 출력 설정
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge 설치 프로그램" -ForegroundColor Cyan  
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 관리자 권한 확인
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Host "⚠️  경고: 관리자 권한으로 실행되지 않았습니다." -ForegroundColor Yellow
    Write-Host "   일부 기능(winget, 시작프로그램 등록)이 제한될 수 있습니다." -ForegroundColor Yellow
    Write-Host ""
}

# 실행 정책 확인
$executionPolicy = Get-ExecutionPolicy -Scope CurrentUser
if ($executionPolicy -eq "Restricted") {
    Write-Host "🔒 실행 정책이 제한되어 있습니다." -ForegroundColor Yellow
    Write-Host "   다음 명령으로 실행 정책을 변경하세요:" -ForegroundColor Yellow
    Write-Host "   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser" -ForegroundColor White
    Write-Host ""
    $continue = Read-Host "계속하시겠습니까? (Y/N)"
    if ($continue -ne "Y" -and $continue -ne "y") {
        exit 1
    }
}

Write-Host "📦 설치 위치: $InstallPath" -ForegroundColor Green
Write-Host ""

# Node.js 설치 확인
if (-not $SkipNodeCheck) {
    Write-Host "🔍 Node.js 설치 확인 중..." -ForegroundColor Cyan
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Host "   ✅ Node.js $nodeVersion 설치됨" -ForegroundColor Green
        }
    } catch {
        Write-Host "   ❌ Node.js가 설치되지 않았습니다." -ForegroundColor Red
        Write-Host ""
        Write-Host "Node.js 설치 방법:" -ForegroundColor Yellow
        Write-Host "  1. winget으로 자동 설치 (권장)" -ForegroundColor White
        Write-Host "  2. 수동 다운로드: https://nodejs.org" -ForegroundColor White
        Write-Host ""
        
        $installNode = Read-Host "winget으로 Node.js를 설치하시겠습니까? (Y/N)"
        if ($installNode -eq "Y" -or $installNode -eq "y") {
            try {
                Write-Host "   Node.js 설치 중..." -ForegroundColor Cyan
                winget install OpenJS.NodeJS.LTS --silent
                Write-Host "   ✅ Node.js 설치 완료" -ForegroundColor Green
                Write-Host "   ⚠️  PowerShell을 다시 시작한 후 설치 스크립트를 재실행하세요." -ForegroundColor Yellow
                exit 0
            } catch {
                Write-Host "   ❌ winget 설치 실패: $_" -ForegroundColor Red
                Write-Host "   수동으로 Node.js를 설치한 후 다시 시도하세요." -ForegroundColor Yellow
                exit 1
            }
        } else {
            Write-Host "   Node.js를 수동으로 설치한 후 이 스크립트를 다시 실행하세요." -ForegroundColor Yellow
            exit 1
        }
    }
}

# 설치 디렉토리 생성
Write-Host ""
Write-Host "📁 설치 디렉토리 생성 중..." -ForegroundColor Cyan
if (-not (Test-Path $InstallPath)) {
    try {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
        Write-Host "   ✅ 디렉토리 생성: $InstallPath" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ 디렉토리 생성 실패: $_" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "   ℹ️  디렉토리가 이미 존재합니다." -ForegroundColor Yellow
}

# GitHub에서 최신 릴리스 다운로드
Write-Host ""
Write-Host "🌐 GitHub에서 최신 릴리스 확인 중..." -ForegroundColor Cyan

$repo = "asomi7007/copilot-powerbi-desktop-mcp-bridge"
$releaseUrl = "https://api.github.com/repos/$repo/releases/latest"

try {
    $release = Invoke-RestMethod -Uri $releaseUrl -Headers @{
        "User-Agent" = "PowerShell"
    }
    $version = $release.tag_name
    Write-Host "   최신 버전: $version" -ForegroundColor Green
    
    # ZIP 파일 찾기
    $zipAsset = $release.assets | Where-Object { $_.name -like "*win-x64.zip" } | Select-Object -First 1
    if (-not $zipAsset) {
        throw "Windows x64 릴리스 파일을 찾을 수 없습니다."
    }
    
    $downloadUrl = $zipAsset.browser_download_url
    $zipPath = Join-Path $env:TEMP "pbi-mcp-bridge.zip"
    
    Write-Host "   다운로드 중: $($zipAsset.name)" -ForegroundColor Cyan
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
    Write-Host "   ✅ 다운로드 완료" -ForegroundColor Green
    
    # 압축 해제
    Write-Host "   압축 해제 중..." -ForegroundColor Cyan
    Expand-Archive -Path $zipPath -DestinationPath $InstallPath -Force
    Remove-Item $zipPath
    Write-Host "   ✅ 압축 해제 완료" -ForegroundColor Green
    
} catch {
    Write-Host "   ⚠️  릴리스 다운로드 실패: $_" -ForegroundColor Yellow
    Write-Host "   소스에서 설치를 시도합니다..." -ForegroundColor Yellow
    
    # Git clone 대체 방법
    Write-Host ""
    Write-Host "🔧 소스에서 설치 중..." -ForegroundColor Cyan
    
    $repoZip = "https://github.com/$repo/archive/refs/heads/main.zip"
    $zipPath = Join-Path $env:TEMP "pbi-mcp-bridge-source.zip"
    
    try {
        Invoke-WebRequest -Uri $repoZip -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force
        
        $sourcePath = Join-Path $env:TEMP "copilot-powerbi-desktop-mcp-bridge-main"
        Copy-Item -Path "$sourcePath\*" -Destination $InstallPath -Recurse -Force
        
        Remove-Item $zipPath
        Remove-Item $sourcePath -Recurse -Force
        
        # npm install 및 빌드
        Write-Host "   의존성 설치 중..." -ForegroundColor Cyan
        Push-Location $InstallPath
        npm install --production 2>&1 | Out-Null
        
        Write-Host "   빌드 중..." -ForegroundColor Cyan
        npm run build 2>&1 | Out-Null
        Pop-Location
        
        Write-Host "   ✅ 소스 설치 완료" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ 소스 설치 실패: $_" -ForegroundColor Red
        exit 1
    }
}

# config.example.yaml을 config.yaml로 복사
Write-Host ""
Write-Host "⚙️  설정 파일 생성 중..." -ForegroundColor Cyan
$configExample = Join-Path $InstallPath "config.example.yaml"
$config = Join-Path $InstallPath "config.yaml"

if (Test-Path $configExample) {
    if (-not (Test-Path $config)) {
        Copy-Item $configExample $config
        Write-Host "   ✅ config.yaml 생성 완료" -ForegroundColor Green
        Write-Host "   필요시 $config 파일을 수정하세요." -ForegroundColor Gray
    } else {
        Write-Host "   ℹ️  config.yaml이 이미 존재합니다 (덮어쓰지 않음)" -ForegroundColor Yellow
    }
}

# 바탕화면 바로가기 생성 (선택적)
if ($CreateDesktopShortcut) {
    Write-Host ""
    Write-Host "🔗 바탕화면 바로가기 생성 중..." -ForegroundColor Cyan
    
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "Power BI MCP Bridge.lnk"
    $targetPath = Join-Path $InstallPath "scripts\start.ps1"
    
    try {
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut($shortcutPath)
        $Shortcut.TargetPath = "powershell.exe"
        $Shortcut.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$targetPath`""
        $Shortcut.WorkingDirectory = $InstallPath
        $Shortcut.IconLocation = "powershell.exe,0"
        $Shortcut.Description = "Power BI MCP Bridge 시작"
        $Shortcut.Save()
        Write-Host "   ✅ 바로가기 생성: $shortcutPath" -ForegroundColor Green
    } catch {
        Write-Host "   ⚠️  바로가기 생성 실패: $_" -ForegroundColor Yellow
    }
}

# 완료 메시지
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  ✅ 설치 완료!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "다음 단계:" -ForegroundColor Cyan
Write-Host "  1. Power BI Desktop을 실행하세요" -ForegroundColor White
Write-Host "  2. 다음 명령으로 Bridge를 시작하세요:" -ForegroundColor White
Write-Host "     cd $InstallPath" -ForegroundColor Gray
Write-Host "     .\scripts\start.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "  또는 바탕화면의 바로가기를 실행하세요 (생성한 경우)" -ForegroundColor White
Write-Host ""
Write-Host "  3. 브라우저에서 http://localhost:5050/health 접속하여 확인" -ForegroundColor White
Write-Host ""
Write-Host "문제 발생 시: $InstallPath\README.md 참고" -ForegroundColor Gray
Write-Host ""
