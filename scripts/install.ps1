# Power BI MCP Bridge installer
# One-click installer that downloads the latest GitHub release and unpacks it.

param(
    [string]$InstallPath = "C:\pbi-mcp-bridge",
    [switch]$SkipNodeCheck,
    [switch]$CreateDesktopShortcut
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge Installer" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Admin rights check
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Host "[!]  Not running as Administrator." -ForegroundColor Yellow
    Write-Host "     Some steps (winget, startup registration) may be limited." -ForegroundColor Yellow
    Write-Host ""
}

# Execution policy check
$executionPolicy = Get-ExecutionPolicy -Scope CurrentUser
if ($executionPolicy -eq "Restricted") {
    Write-Host "[Lock] Execution policy is Restricted." -ForegroundColor Yellow
    Write-Host "       To loosen it run:" -ForegroundColor Yellow
    Write-Host "       Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser" -ForegroundColor White
    Write-Host ""
    $continue = Read-Host "Continue anyway? (Y/N)"
    if ($continue -ne "Y" -and $continue -ne "y") {
        exit 1
    }
}

Write-Host "[Pkg] Install path: $InstallPath" -ForegroundColor Green
Write-Host ""

# Node.js check
if (-not $SkipNodeCheck) {
    Write-Host "Checking Node.js..." -ForegroundColor Cyan
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Host "   [OK] Node.js $nodeVersion" -ForegroundColor Green
        }
    } catch {
        Write-Host "   [X] Node.js is not installed." -ForegroundColor Red
        Write-Host ""
        Write-Host "How to install Node.js:" -ForegroundColor Yellow
        Write-Host "  1. winget (recommended)" -ForegroundColor White
        Write-Host "  2. Manual: https://nodejs.org" -ForegroundColor White
        Write-Host ""

        $installNode = Read-Host "Install Node.js via winget? (Y/N)"
        if ($installNode -eq "Y" -or $installNode -eq "y") {
            try {
                Write-Host "   Installing Node.js..." -ForegroundColor Cyan
                winget install OpenJS.NodeJS.LTS --silent
                Write-Host "   [OK] Node.js installed" -ForegroundColor Green
                Write-Host "   [!]  Restart PowerShell, then re-run this installer." -ForegroundColor Yellow
                exit 0
            } catch {
                Write-Host "   [X] winget install failed: $_" -ForegroundColor Red
                Write-Host "       Install Node.js manually and try again." -ForegroundColor Yellow
                exit 1
            }
        } else {
            Write-Host "   Install Node.js manually and re-run this installer." -ForegroundColor Yellow
            exit 1
        }
    }
}

# Create install directory
Write-Host ""
Write-Host "Creating install directory..." -ForegroundColor Cyan
if (-not (Test-Path $InstallPath)) {
    try {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
        Write-Host "   [OK] Created: $InstallPath" -ForegroundColor Green
    } catch {
        Write-Host "   [X] Failed to create directory: $_" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "   [i] Directory already exists." -ForegroundColor Yellow
}

# Download latest GitHub release
Write-Host ""
Write-Host "Looking up the latest GitHub release..." -ForegroundColor Cyan

$repo = "asomi7007/copilot-powerbi-desktop-mcp-bridge"
$releaseUrl = "https://api.github.com/repos/$repo/releases/latest"

try {
    $release = Invoke-RestMethod -Uri $releaseUrl -Headers @{
        "User-Agent" = "PowerShell"
    }
    $version = $release.tag_name
    Write-Host "   Latest version: $version" -ForegroundColor Green

    # Find the zip
    $zipAsset = $release.assets | Where-Object { $_.name -like "*win-x64*.zip" } | Select-Object -First 1
    if (-not $zipAsset) {
        throw "No Windows x64 zip asset found in the latest release."
    }

    $downloadUrl = $zipAsset.browser_download_url
    $zipPath = Join-Path $env:TEMP "pbi-mcp-bridge.zip"

    Write-Host "   Downloading: $($zipAsset.name)" -ForegroundColor Cyan
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
    Write-Host "   [OK] Downloaded" -ForegroundColor Green

    Write-Host "   Extracting..." -ForegroundColor Cyan
    Expand-Archive -Path $zipPath -DestinationPath $InstallPath -Force
    Remove-Item $zipPath
    Write-Host "   [OK] Extracted" -ForegroundColor Green

} catch {
    Write-Host "   [!]  Release download failed: $_" -ForegroundColor Yellow
    Write-Host "       Falling back to source install..." -ForegroundColor Yellow

    Write-Host ""
    Write-Host "Installing from source..." -ForegroundColor Cyan

    $repoZip = "https://github.com/$repo/archive/refs/heads/master.zip"
    $zipPath = Join-Path $env:TEMP "pbi-mcp-bridge-source.zip"

    try {
        Invoke-WebRequest -Uri $repoZip -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force

        $sourcePath = Join-Path $env:TEMP "copilot-powerbi-desktop-mcp-bridge-master"
        Copy-Item -Path "$sourcePath\*" -Destination $InstallPath -Recurse -Force

        Remove-Item $zipPath
        Remove-Item $sourcePath -Recurse -Force

        Write-Host "   Installing dependencies..." -ForegroundColor Cyan
        Push-Location $InstallPath
        npm install --production 2>&1 | Out-Null

        Write-Host "   Building..." -ForegroundColor Cyan
        npm run build 2>&1 | Out-Null
        Pop-Location

        Write-Host "   [OK] Source install complete" -ForegroundColor Green
    } catch {
        Write-Host "   [X] Source install failed: $_" -ForegroundColor Red
        exit 1
    }
}

# Copy config.example.yaml -> config.yaml
Write-Host ""
Write-Host "Creating config file..." -ForegroundColor Cyan
$configExample = Join-Path $InstallPath "config.example.yaml"
$config = Join-Path $InstallPath "config.yaml"

if (Test-Path $configExample) {
    if (-not (Test-Path $config)) {
        Copy-Item $configExample $config
        Write-Host "   [OK] config.yaml created" -ForegroundColor Green
        Write-Host "       Edit $config if needed." -ForegroundColor Gray
    } else {
        Write-Host "   [i] config.yaml already exists (kept)" -ForegroundColor Yellow
    }
}

# Optional desktop shortcut
if ($CreateDesktopShortcut) {
    Write-Host ""
    Write-Host "Creating desktop shortcut..." -ForegroundColor Cyan

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
        $Shortcut.Description = "Start Power BI MCP Bridge"
        $Shortcut.Save()
        Write-Host "   [OK] Shortcut: $shortcutPath" -ForegroundColor Green
    } catch {
        Write-Host "   [!]  Failed to create shortcut: $_" -ForegroundColor Yellow
    }
}

# Summary
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Install complete" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Launch Power BI Desktop and open a .pbix file" -ForegroundColor White
Write-Host "  2. Start the Bridge:" -ForegroundColor White
Write-Host "     cd $InstallPath" -ForegroundColor Gray
Write-Host "     .\scripts\start.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "  Or use the desktop shortcut (if created)" -ForegroundColor White
Write-Host ""
Write-Host "  3. Open http://localhost:5050/health to confirm" -ForegroundColor White
Write-Host ""
Write-Host "If anything fails, see $InstallPath\README.md" -ForegroundColor Gray
Write-Host ""
