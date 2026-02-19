# Power BI MCP Bridge 시작프로그램 등록 스크립트
# Windows 시작 시 자동으로 Bridge를 실행하도록 설정합니다

param(
    [switch]$Unregister,
    [ValidateSet("TaskScheduler", "Startup")]
    [string]$Method = "TaskScheduler"
)

# UTF-8 출력 설정
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge 시작프로그램 등록" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 관리자 권한 확인
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin -and $Method -eq "TaskScheduler") {
    Write-Host "❌ 이 스크립트는 관리자 권한으로 실행해야 합니다." -ForegroundColor Red
    Write-Host "   PowerShell을 관리자로 실행한 후 다시 시도하세요." -ForegroundColor Yellow
    exit 1
}

# 스크립트 위치
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$startScriptPath = Join-Path $scriptDir "start.ps1"

if (-not (Test-Path $startScriptPath)) {
    Write-Host "❌ start.ps1을 찾을 수 없습니다: $startScriptPath" -ForegroundColor Red
    exit 1
}

if ($Method -eq "TaskScheduler") {
    # Task Scheduler를 사용한 등록 (권장)
    $taskName = "PowerBI-MCP-Bridge"
    
    if ($Unregister) {
        Write-Host "🗑️  작업 스케줄러에서 등록 해제 중..." -ForegroundColor Yellow
        try {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
            Write-Host "   ✅ 등록 해제 완료" -ForegroundColor Green
        } catch {
            Write-Host "   ⚠️  작업을 찾을 수 없거나 이미 해제되었습니다." -ForegroundColor Yellow
        }
    } else {
        Write-Host "📅 작업 스케줄러에 등록 중..." -ForegroundColor Cyan
        Write-Host "   작업명: $taskName" -ForegroundColor Gray
        
        try {
            # 기존 작업 제거 (있는 경우)
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
            
            # 작업 액션 정의
            $action = New-ScheduledTaskAction `
                -Execute "powershell.exe" `
                -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScriptPath`"" `
                -WorkingDirectory $projectDir
            
            # 트리거 정의: 로그온 시
            $trigger = New-ScheduledTaskTrigger -AtLogOn
            
            # 설정
            $settings = New-ScheduledTaskSettingsSet `
                -AllowStartIfOnBatteries `
                -DontStopIfGoingOnBatteries `
                -StartWhenAvailable `
                -RunOnlyIfNetworkAvailable:$false `
                -ExecutionTimeLimit (New-TimeSpan -Hours 0)
            
            # 주체 (현재 사용자)
            $principal = New-ScheduledTaskPrincipal `
                -UserId "$env:USERDOMAIN\$env:USERNAME" `
                -LogonType Interactive `
                -RunLevel Highest
            
            # 작업 등록
            Register-ScheduledTask `
                -TaskName $taskName `
                -Action $action `
                -Trigger $trigger `
                -Settings $settings `
                -Principal $principal `
                -Description "Power BI Desktop MCP Bridge를 자동으로 시작합니다" | Out-Null
            
            Write-Host "   ✅ 작업 스케줄러 등록 완료" -ForegroundColor Green
            Write-Host ""
            Write-Host "ℹ️  이제 Windows 로그인 시 자동으로 Bridge가 시작됩니다." -ForegroundColor Cyan
            Write-Host "   작업 스케줄러(taskschd.msc)에서 '$taskName' 작업을 확인할 수 있습니다." -ForegroundColor Gray
            
        } catch {
            Write-Host "   ❌ 등록 실패: $_" -ForegroundColor Red
            exit 1
        }
    }
    
} elseif ($Method -eq "Startup") {
    # 시작프로그램 폴더 방법 (간단하지만 제한적)
    $startupFolder = [Environment]::GetFolderPath("Startup")
    $shortcutPath = Join-Path $startupFolder "Power BI MCP Bridge.lnk"
    
    if ($Unregister) {
        Write-Host "🗑️  시작프로그램 폴더에서 제거 중..." -ForegroundColor Yellow
        if (Test-Path $shortcutPath) {
            Remove-Item $shortcutPath -Force
            Write-Host "   ✅ 제거 완료" -ForegroundColor Green
        } else {
            Write-Host "   ℹ️  바로가기가 존재하지 않습니다." -ForegroundColor Yellow
        }
    } else {
        Write-Host "📂 시작프로그램 폴더에 바로가기 생성 중..." -ForegroundColor Cyan
        Write-Host "   위치: $startupFolder" -ForegroundColor Gray
        
        try {
            $WshShell = New-Object -ComObject WScript.Shell
            $Shortcut = $WshShell.CreateShortcut($shortcutPath)
            $Shortcut.TargetPath = "powershell.exe"
            $Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScriptPath`""
            $Shortcut.WorkingDirectory = $projectDir
            $Shortcut.IconLocation = "powershell.exe,0"
            $Shortcut.Description = "Power BI MCP Bridge 자동 시작"
            $Shortcut.Save()
            
            Write-Host "   ✅ 바로가기 생성 완료" -ForegroundColor Green
            Write-Host ""
            Write-Host "ℹ️  이제 Windows 로그인 시 자동으로 Bridge가 시작됩니다." -ForegroundColor Cyan
            
        } catch {
            Write-Host "   ❌ 바로가기 생성 실패: $_" -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host ""
Write-Host "사용법:" -ForegroundColor Cyan
Write-Host "  등록:   .\register-startup.ps1" -ForegroundColor White
Write-Host "  해제:   .\register-startup.ps1 -Unregister" -ForegroundColor White
Write-Host "  방법 선택: .\register-startup.ps1 -Method Startup" -ForegroundColor White
Write-Host ""
