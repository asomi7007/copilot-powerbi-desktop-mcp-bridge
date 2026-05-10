# Power BI MCP Bridge - register / unregister startup launch.

param(
    [switch]$Unregister,
    [ValidateSet("TaskScheduler", "Startup")]
    [string]$Method = "TaskScheduler"
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge - Startup Registration" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Admin rights check (Task Scheduler needs them; Startup folder does not)
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin -and $Method -eq "TaskScheduler") {
    Write-Host "[X] This script must run as Administrator." -ForegroundColor Red
    Write-Host "    Re-launch PowerShell as Administrator and try again." -ForegroundColor Yellow
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$startScriptPath = Join-Path $scriptDir "start.ps1"

if (-not (Test-Path $startScriptPath)) {
    Write-Host "[X] Could not find start.ps1: $startScriptPath" -ForegroundColor Red
    exit 1
}

if ($Method -eq "TaskScheduler") {
    # Recommended: Task Scheduler entry
    $taskName = "PowerBI-MCP-Bridge"

    if ($Unregister) {
        Write-Host "Removing scheduled task..." -ForegroundColor Yellow
        try {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
            Write-Host "   [OK] Removed" -ForegroundColor Green
        } catch {
            Write-Host "   [!]  Task not found (or already removed)." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Registering scheduled task..." -ForegroundColor Cyan
        Write-Host "   Task name: $taskName" -ForegroundColor Gray

        try {
            # Remove pre-existing task with same name
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

            # Action: launch start.ps1 hidden
            $action = New-ScheduledTaskAction `
                -Execute "powershell.exe" `
                -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScriptPath`"" `
                -WorkingDirectory $projectDir

            # Trigger: at user logon
            $trigger = New-ScheduledTaskTrigger -AtLogOn

            # Settings
            $settings = New-ScheduledTaskSettingsSet `
                -AllowStartIfOnBatteries `
                -DontStopIfGoingOnBatteries `
                -StartWhenAvailable `
                -RunOnlyIfNetworkAvailable:$false `
                -ExecutionTimeLimit (New-TimeSpan -Hours 0)

            # Principal: current interactive user, highest privileges
            $principal = New-ScheduledTaskPrincipal `
                -UserId "$env:USERDOMAIN\$env:USERNAME" `
                -LogonType Interactive `
                -RunLevel Highest

            Register-ScheduledTask `
                -TaskName $taskName `
                -Action $action `
                -Trigger $trigger `
                -Settings $settings `
                -Principal $principal `
                -Description "Auto-start the Power BI Desktop MCP Bridge" | Out-Null

            Write-Host "   [OK] Scheduled task registered" -ForegroundColor Green
            Write-Host ""
            Write-Host "[i] The Bridge will now start automatically at Windows logon." -ForegroundColor Cyan
            Write-Host "    Verify in Task Scheduler (taskschd.msc) under '$taskName'." -ForegroundColor Gray

        } catch {
            Write-Host "   [X] Registration failed: $_" -ForegroundColor Red
            exit 1
        }
    }

} elseif ($Method -eq "Startup") {
    # Simpler alternative: Startup folder shortcut
    $startupFolder = [Environment]::GetFolderPath("Startup")
    $shortcutPath = Join-Path $startupFolder "Power BI MCP Bridge.lnk"

    if ($Unregister) {
        Write-Host "Removing startup-folder shortcut..." -ForegroundColor Yellow
        if (Test-Path $shortcutPath) {
            Remove-Item $shortcutPath -Force
            Write-Host "   [OK] Removed" -ForegroundColor Green
        } else {
            Write-Host "   [i] Shortcut does not exist." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Creating startup-folder shortcut..." -ForegroundColor Cyan
        Write-Host "   Folder: $startupFolder" -ForegroundColor Gray

        try {
            $WshShell = New-Object -ComObject WScript.Shell
            $Shortcut = $WshShell.CreateShortcut($shortcutPath)
            $Shortcut.TargetPath = "powershell.exe"
            $Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScriptPath`""
            $Shortcut.WorkingDirectory = $projectDir
            $Shortcut.IconLocation = "powershell.exe,0"
            $Shortcut.Description = "Auto-start Power BI MCP Bridge"
            $Shortcut.Save()

            Write-Host "   [OK] Shortcut created" -ForegroundColor Green
            Write-Host ""
            Write-Host "[i] The Bridge will now start automatically at Windows logon." -ForegroundColor Cyan

        } catch {
            Write-Host "   [X] Failed to create shortcut: $_" -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host ""
Write-Host "Usage:" -ForegroundColor Cyan
Write-Host "  Register:   .\register-startup.ps1" -ForegroundColor White
Write-Host "  Unregister: .\register-startup.ps1 -Unregister" -ForegroundColor White
Write-Host "  Use Startup folder: .\register-startup.ps1 -Method Startup" -ForegroundColor White
Write-Host ""
