<#
.SYNOPSIS
    Power BI MCP Bridge - prerequisites + bridge installer.

.DESCRIPTION
    Checks and installs four components in order:

      1) Power BI Desktop          - winget Microsoft.PowerBI
      2) On-premises Data Gateway  - official installer download + GUI wizard
      3) powerbi-modeling-mcp      - VS Code Marketplace VSIX extraction
      4) Bridge itself             - run-in-place or fall back to install.ps1

    Security model:
      - TLS 1.2+ enforced
      - Only official Microsoft / VS Code Marketplace URLs are used
      - Downloaded installers are verified via Authenticode signature before execution
      - winget preferred (signed and verified packages)
      - Each step asks for confirmation (-NonInteractive bypasses prompts)
      - All actions are written to a log file for post-mortem review

.PARAMETER InstallPath
    Bridge install path (default: C:\pbi-mcp-bridge)

.PARAMETER NonInteractive
    Auto-answer Y to all prompts. Use for CI or silent installs.

.PARAMETER SkipPowerBIDesktop
    Skip the Power BI Desktop step.

.PARAMETER SkipGateway
    Skip the On-premises Data Gateway step.

.PARAMETER SkipMcp
    Skip the powerbi-modeling-mcp step.

.PARAMETER SkipBridge
    Skip the Bridge step (only check prerequisites).

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
# Global state
# ============================================================================
$script:LogFile = Join-Path $env:TEMP ("pbi-mcp-bridge-install-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$script:StepTotal = 4
$script:MicrosoftIssuerHints = @('Microsoft Corporation', 'Microsoft Code Signing')

# Force TLS 1.2+ (older Windows may default to 1.0/1.1)
[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ============================================================================
# Output / logging helpers
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
# Environment / security helpers
# ============================================================================
function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Elevate {
    # Re-launch the current script with admin rights and exit the unprivileged process
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
    Write-Info "Re-launching: powershell.exe $($argList -join ' ')"
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs | Out-Null
    exit 0
}

function Test-Authenticode {
    <#
    Verify a file is digitally signed by Microsoft.
    Returns true only if Status is Valid and the signer subject matches a known Microsoft hint.
    Robust against URL changes (trust is rooted in the signature, not the URL).
    #>
    param([string]$FilePath)
    if (-not (Test-Path $FilePath)) { return $false }
    $sig = Get-AuthenticodeSignature -FilePath $FilePath
    Write-Log ("Authenticode: status={0}, subject='{1}'" -f $sig.Status, $sig.SignerCertificate.Subject) 'SIGN'
    if ($sig.Status -ne 'Valid') {
        Write-Warn "Signature status is not Valid: $($sig.Status)"
        return $false
    }
    $subject = $sig.SignerCertificate.Subject
    foreach ($hint in $script:MicrosoftIssuerHints) {
        if ($subject -match [Regex]::Escape($hint)) { return $true }
    }
    Write-Warn "Signer does not appear to be Microsoft: $subject"
    return $false
}

function Invoke-WebDownload {
    <#
    Visible download with byte counter.
    Streams chunks so the user always sees progress, even on slow networks.
    Throws if the resulting file is smaller than $MinBytes (used to detect
    HTML redirect pages saved as .exe).
    #>
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$OutFile,
        [long]$MinBytes = 0
    )
    Write-Info "Downloading: $Url"
    Remove-FileSafe -Path $OutFile

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.AllowAutoRedirect = $true
    $req.UserAgent = 'pbi-mcp-bridge-installer'
    $req.Timeout = 30000
    $req.ReadWriteTimeout = 30000

    try {
        $resp = $req.GetResponse()
    } catch {
        throw "HTTP error: $($_.Exception.Message)"
    }
    try {
        $totalBytes = $resp.ContentLength
        $reader = $resp.GetResponseStream()
        $writer = [System.IO.File]::Open($OutFile, 'Create')
        try {
            $buffer = New-Object byte[] (64 * 1024)
            $downloaded = 0L
            $lastReport = 0L
            while ($true) {
                $n = $reader.Read($buffer, 0, $buffer.Length)
                if ($n -le 0) { break }
                $writer.Write($buffer, 0, $n)
                $downloaded += $n
                # Print status every ~512KB so the console keeps moving
                if (($downloaded - $lastReport) -ge (512 * 1024)) {
                    $lastReport = $downloaded
                    if ($totalBytes -gt 0) {
                        $pct = [int](($downloaded * 100) / $totalBytes)
                        $msg = "       {0,3}%  {1,7:N1} / {2,7:N1} MB" -f $pct, ($downloaded / 1MB), ($totalBytes / 1MB)
                    } else {
                        $msg = "       {0,7:N1} MB" -f ($downloaded / 1MB)
                    }
                    Write-Host "`r$msg" -NoNewline -ForegroundColor DarkGray
                }
            }
        } finally {
            $writer.Close()
            $reader.Close()
        }
    } finally {
        $resp.Close()
    }
    Write-Host ""  # finalize the progress line

    $sw.Stop()
    if (-not (Test-Path $OutFile)) { throw "Download failed: file was not created" }
    $size = (Get-Item $OutFile).Length
    $sizeMB = $size / 1MB
    Write-Info ("Saved: {0:N1} MB ({1:N1}s) -> {2}" -f $sizeMB, $sw.Elapsed.TotalSeconds, $OutFile)

    if ($MinBytes -gt 0 -and $size -lt $MinBytes) {
        $minMB = $MinBytes / 1MB
        Remove-FileSafe -Path $OutFile
        throw ("Download too small ({0:N1} MB < expected at least {1:N1} MB). The URL likely redirected to an HTML page rather than the binary." -f $sizeMB, $minMB)
    }
}

function Remove-FileSafe {
    <#
    Idempotent file delete that survives weird path resolution
    (e.g. Korean usernames whose 8.3 short form can confuse Remove-Item).
    Never throws.
    #>
    param([Parameter(Mandatory)][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    try {
        if ([System.IO.File]::Exists($Path)) {
            [System.IO.File]::Delete($Path)
        }
    } catch {
        Write-Log ("Remove-FileSafe ignored: {0} ({1})" -f $Path, $_.Exception.Message) 'WARN'
    }
}

function Test-Winget {
    return [bool](Get-Command winget -ErrorAction SilentlyContinue)
}

function Invoke-Winget {
    <#
    Run winget with visible progress streamed to the console.
    We DO NOT pass --silent because then the user sees nothing for several
    minutes; instead we let winget print its progress bar live.
    #>
    param([Parameter(Mandatory)][string]$Id, [string]$Name = $Id)
    Write-Info "winget install --exact --id $Id  (live progress below)"
    Write-Host "    -----------------------------------------------------" -ForegroundColor DarkGray
    & winget install --exact --id $Id `
        --accept-package-agreements --accept-source-agreements `
        --disable-interactivity
    $code = $LASTEXITCODE
    Write-Host "    -----------------------------------------------------" -ForegroundColor DarkGray
    Write-Log ("winget exit=$code id=$Id") 'WINGET'
    # winget exit codes: 0 = success, 0x8A150006 = already up-to-date (no upgrade applicable)
    if ($code -ne 0 -and $code -ne -1978335214) {
        throw "winget install failed ($Name): exit $code"
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
    # Microsoft Store version
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
        Write-Warn "winget is not installed. Manual install required."
        Write-Host "    Official download: https://powerbi.microsoft.com/desktop/" -ForegroundColor White
        if (Read-YesNo "Open the download page in a browser?" 'Y') {
            Start-Process 'https://powerbi.microsoft.com/desktop/'
        }
        throw "Cannot auto-install Power BI Desktop (winget unavailable)"
    }
    Invoke-Winget -Id 'Microsoft.PowerBI' -Name 'Power BI Desktop'
}

function Step-PowerBIDesktop {
    Write-Step 1 "Power BI Desktop"
    $r = Test-PowerBIDesktop
    if ($r.Found) {
        Write-Ok ("Already installed: {0}  [{1}]" -f $r.Path, $r.Source)
        return
    }
    Write-Warn "Power BI Desktop is not installed."
    Write-Host "    The Bridge needs Power BI Desktop to read data from a .pbix model." -ForegroundColor Gray
    if (-not (Read-YesNo "Install now? (winget, ~2-5 min)" 'Y')) {
        Write-Warn "Skipping Power BI Desktop. Install it manually before using the Bridge."
        return
    }
    Install-PowerBIDesktop
    $r2 = Test-PowerBIDesktop
    if ($r2.Found) {
        Write-Ok "Install complete: $($r2.Path)"
    } else {
        Write-Warn "Post-install check failed. See winget output in the log."
    }
}

# ============================================================================
# [2] On-premises Data Gateway
# ============================================================================
function Test-DataGateway {
    # Service name varies between Standard mode and Personal mode; check all known names
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
    # Official Microsoft Download Center installer.
    # Trust comes from Authenticode signature verification, not the URL.
    # MinBytes guards against the aka.ms shorteners returning an HTML page.
    $urls = @(
        'https://download.microsoft.com/download/D/A/1/DA1FDDB8-6DA8-4F50-B4D0-18019591E182/GatewayInstall.exe',
        'https://aka.ms/OnPremisesDataGatewayStandardInstaller'
    )
    $tmp = Join-Path $env:TEMP "GatewayInstall.exe"
    $minBytes = 50 * 1024 * 1024  # real installer is ~120 MB

    $downloaded = $false
    foreach ($u in $urls) {
        try {
            Invoke-WebDownload -Url $u -OutFile $tmp -MinBytes $minBytes
            $downloaded = $true
            break
        } catch {
            Write-Warn "Download attempt failed ($u): $_"
        }
    }
    if (-not $downloaded) {
        Remove-FileSafe -Path $tmp
        Write-Warn "Could not auto-download the Gateway installer."
        Write-Host "    Manual download page: https://powerbi.microsoft.com/gateway/" -ForegroundColor White
        if (Read-YesNo "Open the download page in a browser?" 'Y') {
            Start-Process 'https://powerbi.microsoft.com/gateway/'
        }
        throw "Gateway auto-download failed"
    }

    if (-not (Test-Authenticode -FilePath $tmp)) {
        Remove-FileSafe -Path $tmp
        throw "Gateway installer failed Microsoft Authenticode signature check. Aborting for security."
    }
    Write-Ok "Signature verified (Microsoft Corporation)"

    Write-Host ""
    Write-Host "    -----------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "    The Gateway install wizard will launch now." -ForegroundColor Yellow
    Write-Host "    1) Accept the license and click [Install]" -ForegroundColor White
    Write-Host "    2) Sign in with a Microsoft account that has a Power BI license" -ForegroundColor White
    Write-Host "    3) Select [Register a new gateway on this computer]" -ForegroundColor White
    Write-Host "    4) Pick a gateway name + back up the recovery key" -ForegroundColor White
    Write-Host "    -----------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    if (-not (Read-YesNo "Ready to launch the wizard?" 'Y')) {
        Remove-FileSafe -Path $tmp
        Write-Warn "User cancelled Gateway install"
        return
    }
    Start-Process -FilePath $tmp -Wait
    Remove-FileSafe -Path $tmp
}

function Step-DataGateway {
    Write-Step 2 "On-premises Data Gateway"
    $r = Test-DataGateway
    if ($r.Found) {
        if ($r.Service) {
            Write-Ok ("Already installed: service '{0}' (status {1})" -f $r.Service, $r.Status)
        } else {
            Write-Ok ("Already installed: $($r.Path)")
        }
        return
    }
    Write-Warn "On-premises Data Gateway is not installed."
    Write-Host "    This gateway is the official Microsoft component that lets" -ForegroundColor Gray
    Write-Host "    Copilot Studio reach the local Bridge securely." -ForegroundColor Gray
    Write-Host "    After install you must sign in and register the gateway." -ForegroundColor Gray
    if (-not (Read-YesNo "Download now and launch the install wizard?" 'Y')) {
        Write-Warn "Skipping Gateway. It is required when wiring up Copilot Studio."
        return
    }
    Install-DataGateway
    $r2 = Test-DataGateway
    if ($r2.Found) { Write-Ok "Gateway install verified" }
    else { Write-Warn "Service not detected post-install. Did the wizard complete?" }
}

# ============================================================================
# [3] powerbi-modeling-mcp (MCP server)
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
    # Official VS Code Marketplace VSIX (which is a ZIP).
    # Extracting into ~/.vscode/extensions makes it discoverable by the Bridge's mcp-discovery.
    $vsixUrl = 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/analysis-services/vsextensions/powerbi-modeling-mcp/latest/vspackage?targetPlatform=win32-x64'
    $vsixTmp = Join-Path $env:TEMP 'powerbi-modeling-mcp.vsix'
    $extractRoot = Join-Path $env:TEMP ("pbi-mcp-extract-" + [Guid]::NewGuid().ToString('N'))

    Invoke-WebDownload -Url $vsixUrl -OutFile $vsixTmp -MinBytes (1 * 1024 * 1024)

    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    Expand-Archive -Path $vsixTmp -DestinationPath $extractRoot -Force

    $extensionRoot = Join-Path $extractRoot 'extension'
    if (-not (Test-Path $extensionRoot)) {
        try { Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue } catch {}
        throw "VSIX layout unexpected: missing 'extension' folder"
    }

    # Pull version from package.json so the folder name lets Bridge auto-discovery sort by latest
    $version = '0.0.0'
    $pkgJsonPath = Join-Path $extensionRoot 'package.json'
    if (Test-Path $pkgJsonPath) {
        try {
            $pkg = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
            if ($pkg.version) { $version = $pkg.version }
        } catch {
            Write-Warn "Failed to parse package.json; using default version $version"
        }
    }

    # Informational signature check (trust path is the Marketplace itself)
    $mcpExe = Join-Path $extensionRoot 'server\powerbi-modeling-mcp.exe'
    if (-not (Test-Path $mcpExe)) {
        try { Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue } catch {}
        throw "MCP executable not found in VSIX: server\powerbi-modeling-mcp.exe"
    }
    $sig = Get-AuthenticodeSignature -FilePath $mcpExe
    if ($sig.Status -eq 'Valid') {
        Write-Ok "MCP exe signature: $($sig.SignerCertificate.Subject)"
    } else {
        Write-Warn "MCP exe is unsigned or unverified (status=$($sig.Status)). Proceeding because source is the VS Code Marketplace."
    }

    # Move into ~/.vscode/extensions/analysis-services.powerbi-modeling-mcp-{version}
    $targetParent = Join-Path $env:USERPROFILE '.vscode\extensions'
    $targetDir = Join-Path $targetParent ("analysis-services.powerbi-modeling-mcp-$version")
    if (-not (Test-Path $targetParent)) {
        New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
    }
    if (Test-Path $targetDir) {
        Write-Info "Replacing existing installation: $targetDir"
        Remove-Item $targetDir -Recurse -Force
    }
    Move-Item -Path $extensionRoot -Destination $targetDir -Force

    Remove-FileSafe -Path $vsixTmp
    try { Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue } catch {}

    Write-Ok "Installed at: $targetDir"
}

function Step-PowerBIMcp {
    Write-Step 3 "powerbi-modeling-mcp (MCP server)"
    $r = Test-PowerBIMcp
    if ($r.Found) {
        Write-Ok ("Already installed: $($r.Path)")
        Write-Info "Version folder: $($r.Source)"
        return
    }
    Write-Warn "powerbi-modeling-mcp is not installed."
    Write-Host "    Will download the official package from the VS Code Marketplace" -ForegroundColor Gray
    Write-Host "    (analysis-services.powerbi-modeling-mcp)." -ForegroundColor Gray
    if (-not (Read-YesNo "Install now? (~30-60 sec)" 'Y')) {
        Write-Warn "Skipping MCP install. The Bridge will try to auto-download it on startup."
        return
    }
    Install-PowerBIMcp
    $r2 = Test-PowerBIMcp
    if ($r2.Found) { Write-Ok "Verified: $($r2.Path)" }
    else { throw "MCP exe not found after install" }
}

# ============================================================================
# [4] Bridge itself
# ============================================================================
function New-DesktopShortcut {
    param([Parameter(Mandatory)][string]$ProjectRoot)
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop 'Power BI MCP Bridge.lnk'
    $startScript = Join-Path $ProjectRoot 'scripts\start.ps1'
    if (-not (Test-Path $startScript)) {
        Write-Warn "start.ps1 missing - skipping shortcut: $startScript"
        return
    }
    try {
        $sh = New-Object -ComObject WScript.Shell
        $sc = $sh.CreateShortcut($shortcutPath)
        $sc.TargetPath = 'powershell.exe'
        $sc.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$startScript`""
        $sc.WorkingDirectory = $ProjectRoot
        $sc.IconLocation = 'powershell.exe,0'
        $sc.Description = 'Start Power BI MCP Bridge'
        $sc.Save()
        Write-Ok "Desktop shortcut: $shortcutPath"
    } catch {
        Write-Warn "Shortcut creation failed: $_"
    }
}

function Initialize-LocalBridge {
    <#
    Run-in-place setup for the extracted release zip.
    Creates config.yaml from the example and (optionally) a desktop shortcut.
    #>
    param([Parameter(Mandatory)][string]$ProjectRoot)

    $configExample = Join-Path $ProjectRoot 'config.example.yaml'
    $config        = Join-Path $ProjectRoot 'config.yaml'
    if (-not (Test-Path $config) -and (Test-Path $configExample)) {
        Copy-Item $configExample $config
        Write-Ok "Created config.yaml: $config"
    } elseif (Test-Path $config) {
        Write-Info "Keeping existing config.yaml: $config"
    }

    # Create the filesystem-tools sandbox folder up front so the user can see where it lives.
    # The Bridge would create it on startup anyway when allowedPaths is empty.
    $workspace = Join-Path $ProjectRoot 'workspace'
    if (-not (Test-Path $workspace)) {
        New-Item -ItemType Directory -Path $workspace -Force | Out-Null
        Write-Ok "Created filesystem sandbox: $workspace"
    } else {
        Write-Info "Filesystem sandbox exists: $workspace"
    }

    if (Read-YesNo "Create a desktop shortcut?" 'Y') {
        New-DesktopShortcut -ProjectRoot $ProjectRoot
    }

    Write-Host ""
    Write-Host "    Bridge location: $ProjectRoot" -ForegroundColor Gray
    Write-Host "    Start command  : .\scripts\start.ps1" -ForegroundColor Gray
}

function Step-Bridge {
    Write-Step 4 "Power BI MCP Bridge"

    # install-all.ps1 lives in scripts\, so the project root is one level up
    $projectRoot = Split-Path $PSScriptRoot -Parent

    # Priority 1: release zip layout - .exe at the root
    $localExeRoot = Join-Path $projectRoot 'pbi-mcp-bridge.exe'
    if (Test-Path $localExeRoot) {
        Write-Ok "Pre-built .exe found: $localExeRoot"
        Write-Info "Node.js not required. Using the current folder as the install location."
        Initialize-LocalBridge -ProjectRoot $projectRoot
        return
    }

    # Priority 2: dev layout - .exe under release\
    $localExeSub = Join-Path $projectRoot 'release\pbi-mcp-bridge.exe'
    if (Test-Path $localExeSub) {
        Write-Info "Found release\pbi-mcp-bridge.exe; copying to project root for start.ps1 compatibility"
        Copy-Item $localExeSub $localExeRoot -Force
        Write-Ok "Copied to: $localExeRoot"
        Initialize-LocalBridge -ProjectRoot $projectRoot
        return
    }

    # Priority 3: source build artifact - dist\index.js (Node.js required)
    if (Test-Path (Join-Path $projectRoot 'dist\index.js')) {
        Write-Warn "No pre-built .exe. Will use dist\index.js, which needs the Node.js runtime."
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            Write-Warn "Node.js is not installed. dist\index.js requires Node.js 20+."
        }
        Initialize-LocalBridge -ProjectRoot $projectRoot
        return
    }

    # Priority 4: fall back to existing install.ps1 (remote download / source build)
    Write-Info "No local build artifacts. Falling back to install.ps1 (remote install)."
    $existingInstaller = Join-Path $PSScriptRoot 'install.ps1'
    if (-not (Test-Path $existingInstaller)) {
        Write-Warn "install.ps1 not found ($existingInstaller). Skipping Bridge step."
        return
    }
    & $existingInstaller -InstallPath $InstallPath -CreateDesktopShortcut
}

# ============================================================================
# Main
# ============================================================================
Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge - Installer" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  Log: $script:LogFile" -ForegroundColor DarkGray
Write-Host ""
Write-Log ("Start: User=$env:USERNAME, OS=$([System.Environment]::OSVersion.VersionString), PSVer=$($PSVersionTable.PSVersion)") 'BOOT'

# Admin check + auto-elevate
if (-not (Test-IsAdmin)) {
    Write-Warn "Administrator rights are required. Re-launching with UAC..."
    Start-Sleep -Seconds 1
    Invoke-Elevate
}
Write-Ok "Administrator rights confirmed"

# Windows version
$os = [System.Environment]::OSVersion.Version
if ($os.Major -lt 10) {
    Write-Err "Windows 10 or later required. Current: $os"
    exit 1
}
Write-Ok ("Windows {0}.{1} detected" -f $os.Major, $os.Minor)

# Execution policy
$ep = Get-ExecutionPolicy -Scope CurrentUser
if ($ep -eq 'Restricted' -or $ep -eq 'AllSigned') {
    Write-Warn "Current execution policy: $ep"
    if (Read-YesNo "Change to RemoteSigned for the current user?" 'Y') {
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
        Write-Ok "Execution policy changed"
    }
}

# Run the steps. Steps 1-3 are best-effort: if one fails, log a warning and
# keep going so the user still ends up with a registered Bridge in Step 4.
# Only Step 4 failure is fatal (the Bridge is the whole point).
$stepFailures = @()

function Invoke-Step {
    param([string]$Label, [scriptblock]$Body, [bool]$Fatal = $false)
    try {
        & $Body
    } catch {
        $msg = "$Label failed: $_"
        Write-Warn $msg
        Write-Log ($_ | Out-String) 'STEP_ERROR'
        $script:stepFailures += $Label
        if ($Fatal) {
            Write-Host ""
            Write-Err "Fatal: cannot continue without $Label."
            Write-Host "    Detailed log: $script:LogFile" -ForegroundColor Yellow
            if (-not $NonInteractive) {
                Write-Host ""
                Read-Host "Press ENTER to exit"
            }
            exit 1
        }
    }
}

if ($SkipPowerBIDesktop) { Write-Step 1 "Power BI Desktop (skipped)" } else { Invoke-Step "Power BI Desktop" { Step-PowerBIDesktop } }
if ($SkipGateway)        { Write-Step 2 "Gateway (skipped)" }            else { Invoke-Step "Gateway"          { Step-DataGateway } }
if ($SkipMcp)            { Write-Step 3 "MCP (skipped)" }                else { Invoke-Step "MCP"              { Step-PowerBIMcp } }
if ($SkipBridge)         { Write-Step 4 "Bridge (skipped)" }             else { Invoke-Step "Bridge"           { Step-Bridge } -Fatal $true }

# Completion banner
Write-Host ""
if ($stepFailures.Count -gt 0) {
    Write-Host "=========================================================" -ForegroundColor Yellow
    Write-Host "  Install finished with warnings" -ForegroundColor Yellow
    Write-Host "=========================================================" -ForegroundColor Yellow
    Write-Host "  These steps reported a problem (see log for details):" -ForegroundColor Yellow
    foreach ($f in $stepFailures) { Write-Host "    - $f" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "  The Bridge itself is registered and can still be started." -ForegroundColor Gray
    Write-Host "  Re-run Install.bat after addressing the warnings to retry the failed steps." -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host "  Install complete!" -ForegroundColor Green
    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host ""
}
$bridgeRoot = Split-Path $PSScriptRoot -Parent
$samplePbix = Join-Path $bridgeRoot 'samples\BI-sample.pbix'
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1) Launch Power BI Desktop and open a .pbix file"
if (Test-Path $samplePbix) {
    Write-Host "       Sample model: $samplePbix" -ForegroundColor DarkGray
}
Write-Host "  2) Start the Bridge (or double-click the desktop shortcut):" -ForegroundColor White
Write-Host "       cd `"$bridgeRoot`"" -ForegroundColor DarkGray
Write-Host "       .\scripts\start.ps1" -ForegroundColor DarkGray
Write-Host "  3) Open http://localhost:5050/health to confirm"
$workspaceHint = Join-Path $bridgeRoot 'workspace'
if (Test-Path $workspaceHint) {
    Write-Host ""
    Write-Host "  Filesystem MCP sandbox:" -ForegroundColor Cyan
    Write-Host "    $workspaceHint" -ForegroundColor DarkGray
    Write-Host "    Copilot Studio's read_file / write_file / list_directory operate inside this folder only." -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  Log: $script:LogFile" -ForegroundColor DarkGray
Write-Host ""

if (-not $NonInteractive) {
    Read-Host "Press ENTER to exit"
}
