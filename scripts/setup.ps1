# Power BI MCP Bridge 설정 스크립트
# 설정 재설정 및 재구성을 위한 인터랙티브 도구

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Power BI MCP Bridge 설정" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir

# 옵션 선택
Write-Host "선택하세요:" -ForegroundColor Yellow
Write-Host "  1. 설정 마법사 실행 (인터랙티브)" 
Write-Host "  2. 설정 초기화 (기본값으로 리셋)"
Write-Host "  3. MCP exe 경로만 변경"
Write-Host "  4. 현재 설정 확인"
Write-Host "  q. 취소"
Write-Host ""

$choice = Read-Host "선택"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "🔧 설정 마법사를 시작합니다..." -ForegroundColor Cyan
        Write-Host ""
        Push-Location $projectDir
        node dist/index.js --setup
        Pop-Location
    }
    "2" {
        Write-Host ""
        Write-Host "🔄 설정을 초기화합니다..." -ForegroundColor Cyan
        Write-Host ""
        
        $configPath = Join-Path $projectDir "config.yaml"
        $examplePath = Join-Path $projectDir "config.example.yaml"
        
        # 백업 생성
        if (Test-Path $configPath) {
            $backup = "${configPath}.bak"
            Copy-Item $configPath $backup -Force
            Write-Host "  📦 기존 설정을 백업했습니다: $backup" -ForegroundColor Gray
        }
        
        # config.example.yaml을 config.yaml로 복사
        if (Test-Path $examplePath) {
            Copy-Item $examplePath $configPath -Force
            Write-Host "  ✅ 설정이 초기화되었습니다." -ForegroundColor Green
            Write-Host ""
            Write-Host "이제 서버를 다시 시작하면 기본 설정이 적용됩니다." -ForegroundColor Gray
        } else {
            Write-Host "  ❌ config.example.yaml을 찾을 수 없습니다." -ForegroundColor Red
        }
        
        Write-Host ""
    }
    "3" {
        Write-Host ""
        Write-Host "📂 MCP exe 경로 변경" -ForegroundColor Cyan
        Write-Host ""
        
        # MCP exe 경로 입력
        $mcpPath = Read-Host "  powerbi-modeling-mcp.exe 경로를 입력하세요"
        
        if ($mcpPath -and (Test-Path $mcpPath)) {
            Write-Host ""
            Write-Host "  경로를 확인했습니다: $mcpPath" -ForegroundColor Gray
            Write-Host "  config.yaml을 업데이트합니다..." -ForegroundColor Gray
            Write-Host ""
            
            # config.yaml에서 mcp.command만 변경
            Push-Location $projectDir
            
            $updateScript = @"
const yaml = require('yaml');
const fs = require('fs');
const path = require('path');

const configPath = path.join(process.cwd(), 'config.yaml');
const examplePath = path.join(process.cwd(), 'config.example.yaml');

let config = {};

// 기존 config.yaml이 있으면 로드, 없으면 example에서 로드
if (fs.existsSync(configPath)) {
    config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
} else if (fs.existsSync(examplePath)) {
    config = yaml.parse(fs.readFileSync(examplePath, 'utf8'));
}

// mcp.command 업데이트
if (!config.mcp) config.mcp = {};
config.mcp.command = '$($mcpPath.Replace('\', '\\'))';

// config.yaml 저장
fs.writeFileSync(configPath, yaml.stringify(config), 'utf8');
console.log('  ✅ MCP 경로가 업데이트되었습니다.');
"@
            
            $updateScript | node
            Pop-Location
            
            Write-Host ""
        } else {
            Write-Host ""
            Write-Host "  ❌ 파일을 찾을 수 없습니다: $mcpPath" -ForegroundColor Red
            Write-Host ""
        }
    }
    "4" {
        Write-Host ""
        Write-Host "📋 현재 설정" -ForegroundColor Cyan
        Write-Host ""
        
        $configPath = Join-Path $projectDir "config.yaml"
        
        if (Test-Path $configPath) {
            Write-Host "  config.yaml 내용:" -ForegroundColor Gray
            Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
            Get-Content $configPath | ForEach-Object { Write-Host "  $_" }
            Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
        } else {
            Write-Host "  config.yaml이 없습니다." -ForegroundColor Yellow
            Write-Host "  기본 설정(config.example.yaml)이 사용됩니다." -ForegroundColor Gray
        }
        
        Write-Host ""
    }
    default {
        Write-Host ""
        Write-Host "취소되었습니다." -ForegroundColor Gray
        Write-Host ""
    }
}

Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
