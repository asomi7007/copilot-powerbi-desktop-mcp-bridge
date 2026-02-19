import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { execSync } from "child_process";

/**
 * powerbi-modeling-mcp.exe를 자동으로 찾는 모듈
 *
 * 탐색 순서:
 * 1. config에 지정된 경로 (절대/상대 경로)
 * 2. VS Code Extensions 폴더 (%USERPROFILE%\.vscode\extensions\analysis-services.powerbi-modeling-mcp-*)
 * 3. VS Code Insiders Extensions 폴더
 * 4. Bridge exe와 같은 폴더
 * 5. 현재 작업 디렉토리
 * 6. PATH 환경변수에서 검색
 * 7. 일반적인 설치 위치:
 *    - %LOCALAPPDATA%\Programs\powerbi-modeling-mcp\
 *    - %PROGRAMFILES%\powerbi-modeling-mcp\
 *    - %USERPROFILE%\.mcp\
 *    - %USERPROFILE%\AppData\Local\powerbi-modeling-mcp\
 *    - %APPDATA%\powerbi-modeling-mcp\
 *    - C:\tools\
 *    - C:\mcp\
 * 8. 재귀 검색은 하지 않음 (성능 이슈)
 */

/**
 * MCP 실행 파일 자동 탐색
 * @param configCommand - config.yaml에 지정된 명령어 (없으면 기본값 사용)
 * @returns 찾은 실행 파일의 전체 경로 또는 null
 */
export async function discoverMcpExecutable(configCommand?: string): Promise<string | null> {
  // config에 절대 경로가 지정되어 있고 파일이 존재하면 바로 반환
  if (configCommand && path.isAbsolute(configCommand)) {
    if (fs.existsSync(configCommand)) {
      return configCommand;
    }
  }
  
  const exeName = configCommand || "powerbi-modeling-mcp.exe";
  
  // 환경변수 추출 (여러 곳에서 사용)
  const userProfile = process.env.USERPROFILE;
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.PROGRAMFILES;
  const programFilesX86 = process.env['PROGRAMFILES(X86)'];
  const appData = process.env.APPDATA;
  
  // VS Code Extensions에서 검색 (최우선!)
  // 패턴: %USERPROFILE%\.vscode\extensions\analysis-services.powerbi-modeling-mcp-*\server\powerbi-modeling-mcp.exe
  if (userProfile) {
    const vscodeExtDir = path.join(userProfile, '.vscode', 'extensions');
    if (fs.existsSync(vscodeExtDir)) {
      try {
        const entries = fs.readdirSync(vscodeExtDir);
        // analysis-services.powerbi-modeling-mcp-로 시작하는 폴더 찾기
        const mcpExtensions = entries
          .filter(e => e.startsWith('analysis-services.powerbi-modeling-mcp-'))
          .sort()  // 버전순 정렬
          .reverse(); // 최신 버전 우선
        
        for (const ext of mcpExtensions) {
          const serverDir = path.join(vscodeExtDir, ext, 'server');
          const exePath = path.join(serverDir, 'powerbi-modeling-mcp.exe');
          if (fs.existsSync(exePath)) {
            return exePath; // 즉시 반환!
          }
        }
      } catch (err) {
        // 읽기 실패 시 무시하고 계속
      }
    }
  }
  
  // VS Code Insiders Extensions에서 검색
  if (userProfile) {
    const vscodeInsidersDir = path.join(userProfile, '.vscode-insiders', 'extensions');
    if (fs.existsSync(vscodeInsidersDir)) {
      try {
        const entries = fs.readdirSync(vscodeInsidersDir);
        const mcpExtensions = entries
          .filter(e => e.startsWith('analysis-services.powerbi-modeling-mcp-'))
          .sort()
          .reverse();
        
        for (const ext of mcpExtensions) {
          const serverDir = path.join(vscodeInsidersDir, ext, 'server');
          const exePath = path.join(serverDir, 'powerbi-modeling-mcp.exe');
          if (fs.existsSync(exePath)) {
            return exePath;
          }
        }
      } catch (err) {
        // 읽기 실패 시 무시하고 계속
      }
    }
  }
  
  // 탐색 경로 목록 생성
  const searchPaths: string[] = [];
  
  // Bridge 실행 파일과 같은 폴더
  searchPaths.push(process.cwd());
  searchPaths.push(path.dirname(process.execPath));
  searchPaths.push(__dirname);
  
  // 환경변수 기반 경로
  if (localAppData) {
    searchPaths.push(path.join(localAppData, 'Programs', 'powerbi-modeling-mcp'));
    searchPaths.push(path.join(localAppData, 'powerbi-modeling-mcp'));
  }
  if (programFiles) {
    searchPaths.push(path.join(programFiles, 'powerbi-modeling-mcp'));
  }
  if (programFilesX86) {
    searchPaths.push(path.join(programFilesX86, 'powerbi-modeling-mcp'));
  }
  if (userProfile) {
    searchPaths.push(path.join(userProfile, '.mcp'));
    searchPaths.push(path.join(userProfile, 'mcp'));
  }
  if (appData) {
    searchPaths.push(path.join(appData, 'powerbi-modeling-mcp'));
  }
  
  searchPaths.push('C:\\tools');
  searchPaths.push('C:\\mcp');
  
  // 각 경로에서 exe 파일 찾기
  for (const dir of searchPaths) {
    try {
      const fullPath = path.join(dir, exeName);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    } catch (error) {
      // 접근 권한이 없는 경로는 무시
      continue;
    }
  }
  
  // PATH에서 검색 (which/where 대안)
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    try {
      const fullPath = path.join(dir, exeName);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    } catch (error) {
      // 접근 권한이 없는 경로는 무시
      continue;
    }
  }
  
  return null;
}

/**
 * GitHub에서 powerbi-modeling-mcp를 다운로드합니다.
 *
 * 다운로드 전략:
 * 1. VS Code Marketplace에서 VSIX 다운로드 (VSIX = ZIP 파일)
 *    URL: https://marketplace.visualstudio.com/_apis/public/gallery/publishers/analysis-services/vsextensions/powerbi-modeling-mcp/latest/vspackage?targetPlatform=win32-x64
 * 2. 또는 GitHub Release에서 직접 다운로드
 *
 * 다운로드 위치: Bridge 실행 파일과 같은 폴더의 mcp-server/ 디렉토리
 *
 * @param targetDir - 다운로드할 대상 디렉토리 (옵션, 기본값: ./mcp-server)
 * @returns 다운로드된 exe 파일의 경로 또는 null (실패 시)
 */
export async function downloadMcpExecutable(targetDir?: string): Promise<string | null> {
  const installDir = targetDir || path.join(process.cwd(), 'mcp-server');
  
  // mcp-server 디렉토리 생성
  if (!fs.existsSync(installDir)) {
    fs.mkdirSync(installDir, { recursive: true });
  }
  
  const exePath = path.join(installDir, 'powerbi-modeling-mcp.exe');
  
  // 이미 다운로드되어 있는지 확인
  if (fs.existsSync(exePath)) {
    return exePath;
  }
  
  console.log('');
  console.log('📥 powerbi-modeling-mcp.exe를 다운로드하고 있습니다...');
  console.log('   출처: VS Code Marketplace (analysis-services.powerbi-modeling-mcp)');
  console.log('');
  
  try {
    // VS Code Marketplace에서 VSIX 다운로드
    const vsixUrl = 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/analysis-services/vsextensions/powerbi-modeling-mcp/latest/vspackage?targetPlatform=win32-x64';
    
    const vsixPath = path.join(installDir, 'temp-extension.vsix');
    await downloadFile(vsixUrl, vsixPath);
    
    // VSIX는 ZIP 파일 → 압축 해제
    // Node.js 내장 zlib은 zip을 직접 못 열므로,
    // child_process로 PowerShell의 Expand-Archive 사용
    const extractDir = path.join(installDir, 'temp-extracted');
    
    console.log('📦 VSIX 압축 해제 중...');
    execSync(`powershell -Command "Expand-Archive -Path '${vsixPath}' -DestinationPath '${extractDir}' -Force"`, {
      timeout: 60000,
      stdio: 'ignore'
    });
    
    // server/powerbi-modeling-mcp.exe 찾기
    const serverDir = path.join(extractDir, 'extension', 'server');
    const sourceExe = path.join(serverDir, 'powerbi-modeling-mcp.exe');
    
    if (fs.existsSync(sourceExe)) {
      // 필요한 파일만 복사 (exe + 동일 폴더의 dll, json 등)
      console.log('📋 파일 복사 중...');
      const serverFiles = fs.readdirSync(serverDir);
      for (const file of serverFiles) {
        const src = path.join(serverDir, file);
        const dest = path.join(installDir, file);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dest);
        }
      }
      
      console.log(`✅ 다운로드 완료: ${exePath}`);
      console.log('');
    } else {
      console.error('❌ VSIX에서 powerbi-modeling-mcp.exe를 찾을 수 없습니다');
      return null;
    }
    
    // 임시 파일 정리
    try {
      fs.rmSync(vsixPath, { force: true });
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch {
      // 정리 실패는 무시
    }
    
    return fs.existsSync(exePath) ? exePath : null;
    
  } catch (error: any) {
    console.error(`❌ 다운로드 실패: ${error.message}`);
    console.error('');
    console.error('  수동 설치 방법:');
    console.error('  1. VS Code에서 "Power BI Modeling MCP" Extension 설치');
    console.error('  2. 또는 https://github.com/nicobailon/powerbi-modeling-mcp 에서 직접 다운로드');
    console.error('');
    return null;
  }
}

/**
 * URL에서 파일을 다운로드합니다 (리다이렉트 지원)
 *
 * @param url - 다운로드할 파일의 URL
 * @param destPath - 저장할 로컬 경로
 * @param maxRedirects - 최대 리다이렉트 횟수 (기본값: 5)
 */
function downloadFile(url: string, destPath: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }
    
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, { headers: { 'User-Agent': 'pbi-mcp-bridge' } }, (response) => {
      // 리다이렉트 처리
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destPath, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(destPath);
      
      // 다운로드 진행 상황 표시
      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;
      
      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (totalSize > 0) {
          const percent = Math.round((downloaded / totalSize) * 100);
          process.stdout.write(`\r   진행: ${percent}% (${Math.round(downloaded / 1024 / 1024)}MB / ${Math.round(totalSize / 1024 / 1024)}MB)`);
        }
      });
      
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        if (totalSize > 0) console.log(''); // 줄바꿈
        resolve();
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
}
