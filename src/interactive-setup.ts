import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

/**
 * MCP exe를 찾지 못했을 때 사용자에게 경로를 물어보고
 * config.yaml을 자동 생성하는 인터랙티브 설정
 * 
 * Node.js의 readline 모듈 사용
 */

/**
 * 인터랙티브 초기 설정 실행
 * @returns 사용자가 입력한 MCP 실행 파일 경로 또는 null (취소 시)
 */
export async function runInteractiveSetup(): Promise<string | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const ask = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });
  };
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           🔧 초기 설정 마법사                           ║');
  console.log('║   powerbi-modeling-mcp.exe를 찾을 수 없습니다.          ║');
  console.log('║   exe 파일의 경로를 입력해주세요.                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('💡 팁: exe 파일을 탐색기에서 찾은 후,');
  console.log('   Shift + 우클릭 → "경로로 복사"를 사용하면 편리합니다.');
  console.log('');
  
  let mcpPath: string | null = null;
  
  while (!mcpPath) {
    const input = await ask('📂 powerbi-modeling-mcp.exe 경로: ');
    
    if (!input || input.toLowerCase() === 'q' || input.toLowerCase() === 'quit') {
      console.log('\n설정을 취소합니다. 나중에 config.yaml을 직접 편집하실 수 있습니다.');
      rl.close();
      return null;
    }
    
    // 따옴표 제거
    const cleanPath = input.replace(/"/g, '').replace(/'/g, '');
    
    if (fs.existsSync(cleanPath)) {
      mcpPath = cleanPath;
    } else {
      console.log('');
      console.log(`❌ 파일을 찾을 수 없습니다: ${cleanPath}`);
      console.log('   경로를 다시 확인해주세요. (q를 입력하면 취소)');
      console.log('');
    }
  }
  
  // config.yaml 자동 생성 여부 질문
  const saveConfig = await ask('\n💾 이 설정을 config.yaml에 저장하시겠습니까? (Y/n): ');
  
  if (!saveConfig || saveConfig.toLowerCase() === 'y' || saveConfig.toLowerCase() === 'yes') {
    const configContent = {
      server: { port: 5050, host: '127.0.0.1' },
      mcp: {
        command: mcpPath,
        args: [],
        startupTimeoutMs: 10000,
        requestTimeoutMs: 30000
      },
      security: { corsOrigins: ['*'] },
      logging: { level: 'info' }
    };
    
    const configPath = path.join(process.cwd(), 'config.yaml');
    try {
      fs.writeFileSync(configPath, yaml.stringify(configContent), 'utf8');
      console.log(`\n✅ 설정이 저장되었습니다: ${configPath}`);
      console.log('   다음 실행부터는 자동으로 이 경로를 사용합니다.');
    } catch (error) {
      console.error(`\n⚠️ config.yaml 저장 실패: ${error}`);
      console.error('   이번에는 입력한 경로로 실행하지만, 다음에는 다시 입력해야 합니다.');
    }
  }
  
  rl.close();
  return mcpPath;
}
