import * as fs from "fs";
import * as path from "path";

/**
 * powerbi-modeling-mcp.exe를 자동으로 찾는 모듈
 * 
 * 탐색 순서:
 * 1. config에 지정된 경로 (절대/상대 경로)
 * 2. Bridge exe와 같은 폴더
 * 3. 현재 작업 디렉토리
 * 4. PATH 환경변수에서 검색
 * 5. 일반적인 설치 위치:
 *    - %LOCALAPPDATA%\Programs\powerbi-modeling-mcp\
 *    - %PROGRAMFILES%\powerbi-modeling-mcp\
 *    - %USERPROFILE%\.mcp\
 *    - %USERPROFILE%\AppData\Local\powerbi-modeling-mcp\
 *    - %APPDATA%\powerbi-modeling-mcp\
 *    - C:\tools\
 *    - C:\mcp\
 * 6. 재귀 검색은 하지 않음 (성능 이슈)
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
  
  // 탐색 경로 목록 생성
  const searchPaths: string[] = [];
  
  // Bridge 실행 파일과 같은 폴더
  searchPaths.push(process.cwd());
  searchPaths.push(path.dirname(process.execPath));
  searchPaths.push(__dirname);
  
  // 환경변수 기반 경로
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.PROGRAMFILES;
  const programFilesX86 = process.env['PROGRAMFILES(X86)'];
  const userProfile = process.env.USERPROFILE;
  const appData = process.env.APPDATA;
  
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
