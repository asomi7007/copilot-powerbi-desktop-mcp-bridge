#!/usr/bin/env node
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { loadConfig } from "./config";
import { initLogger, getLogger } from "./logger";
import { McpClient } from "./mcp-client";
import { createServer } from "./server";
import { discoverMcpExecutable, downloadMcpExecutable } from "./mcp-discovery";
import { runInteractiveSetup } from "./interactive-setup";

/**
 * 시작 배너 출력
 */
function printBanner(port: number, host: string, mcpCommand: string): void {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   Copilot + Power BI Desktop MCP Bridge                  ║");
  console.log("║   Version 1.0.0                                           ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`🚀 Bridge Server:  http://${host}:${port}`);
  console.log(`📡 MCP Command:    ${mcpCommand}`);
  console.log(`📊 Health Check:   http://${host}:${port}/health`);
  console.log(`📝 MCP Endpoint:   POST http://${host}:${port}/mcp`);
  console.log("");
  console.log("💡 설정 변경:      --setup 인수로 재설정 가능");
  console.log("");
  console.log("Press Ctrl+C to stop");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
}

/**
 * Graceful shutdown 처리
 */
async function gracefulShutdown(
  server: http.Server,
  mcpClient: McpClient,
  signal: string
): Promise<void> {
  const logger = getLogger();
  logger.info(`Received ${signal}, shutting down gracefully...`);

  // MCP 프로세스 중지
  try {
    await mcpClient.stop();
    logger.info("MCP process stopped");
  } catch (error) {
    logger.error(`Failed to stop MCP process: ${error}`);
  }

  // HTTP 서버 중지
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });

  // 타임아웃 후 강제 종료
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

/**
 * MCP 실행 파일 경로를 자동으로 찾거나 사용자에게 물어봄
 */
async function resolveCommand(configCommand: string): Promise<string> {
  const logger = getLogger();
  
  // 1. 자동 탐색
  const discovered = await discoverMcpExecutable(configCommand);
  if (discovered) {
    logger.info(`MCP exe 발견: ${discovered}`);
    return discovered;
  }
  
  // 2. 인터랙티브 설정 (터미널에서 실행 중일 때만)
  if (process.stdin.isTTY) {
    logger.info("MCP exe를 찾지 못했습니다. 인터랙티브 설정을 시작합니다.");
    const userPath = await runInteractiveSetup();
    if (userPath) return userPath;
  } else {
    // 3. non-TTY 환경 (서비스, 백그라운드 등) → 자동 다운로드 시도
    logger.info("MCP exe를 찾지 못했습니다. 자동 다운로드를 시도합니다...");
    const downloadedPath = await downloadMcpExecutable();
    if (downloadedPath) {
      logger.info(`MCP exe 다운로드 완료: ${downloadedPath}`);
      return downloadedPath;
    }
  }
  
  // 4. 모든 방법 실패
  printFriendlyError(configCommand);
  process.exit(1);
}

/**
 * MCP exe를 찾지 못했을 때 친절한 에러 메시지 출력
 */
function printFriendlyError(command: string): void {
  console.error('');
  console.error('╔══════════════════════════════════════════════════════════╗');
  console.error('║  ❌ powerbi-modeling-mcp.exe를 찾을 수 없습니다        ║');
  console.error('╚══════════════════════════════════════════════════════════╝');
  console.error('');
  console.error(`  찾으려는 파일: ${command}`);
  console.error('');
  console.error('  해결 방법:');
  console.error('');
  console.error('  1️⃣  VS Code에서 Extension 설치 (권장):');
  console.error('     - VS Code 열기 → Extensions → "Power BI Modeling MCP" 검색 → 설치');
  console.error('     - Bridge를 다시 실행하면 자동으로 찾습니다.');
  console.error('');
  console.error('  2️⃣  config.yaml에서 경로 직접 지정:');
  console.error('     mcp:');
  console.error('       command: "C:\\Users\\사용자\\.vscode\\extensions\\analysis-services.powerbi-modeling-mcp-xxx\\server\\powerbi-modeling-mcp.exe"');
  console.error('');
  console.error('  3️⃣  환경변수로 지정:');
  console.error('     set MCP_COMMAND=C:\\경로\\powerbi-modeling-mcp.exe');
  console.error('');
  console.error('  4️⃣  Bridge와 같은 폴더에 exe 파일을 복사');
  console.error('');
  console.error('  5️⃣  GitHub에서 직접 다운로드:');
  console.error('     https://github.com/nicobailon/powerbi-modeling-mcp');
  console.error('');
}

/**
 * --reset-config 처리: 설정 초기화
 */
function handleResetConfig(): void {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   🔄 설정 초기화                                         ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log("");

  const configPath = path.join(process.cwd(), "config.yaml");
  const examplePath = path.join(process.cwd(), "config.example.yaml");

  // 기존 config.yaml 백업
  if (fs.existsSync(configPath)) {
    const backupPath = `${configPath}.bak`;
    try {
      fs.copyFileSync(configPath, backupPath);
      console.log(`📦 기존 설정을 백업했습니다: ${backupPath}`);
    } catch (error) {
      console.warn(`⚠️  백업 실패: ${error}`);
    }
  }

  // config.example.yaml을 config.yaml로 복사
  if (fs.existsSync(examplePath)) {
    try {
      fs.copyFileSync(examplePath, configPath);
      console.log(`✅ 설정이 초기화되었습니다: ${configPath}`);
      console.log("");
      console.log("이제 서버를 다시 시작하면 기본 설정이 적용됩니다.");
    } catch (error) {
      console.error(`❌ 초기화 실패: ${error}`);
      process.exit(1);
    }
  } else {
    console.warn("⚠️  config.example.yaml을 찾을 수 없습니다.");
    console.log("설정 파일을 직접 생성해주세요.");
  }

  console.log("");
  process.exit(0);
}

/**
 * --setup/--reconfigure 처리: 인터랙티브 설정 마법사 강제 실행
 */
async function handleSetup(): Promise<void> {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   🔧 설정 마법사                                         ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log("");

  const configPath = path.join(process.cwd(), "config.yaml");

  // 기존 config.yaml 백업
  if (fs.existsSync(configPath)) {
    const backupPath = `${configPath}.bak`;
    try {
      fs.copyFileSync(configPath, backupPath);
      console.log(`📦 기존 설정을 백업했습니다: ${backupPath}`);
      console.log("");
    } catch (error) {
      console.warn(`⚠️  백업 실패: ${error}`);
    }
  }

  // 인터랙티브 설정 실행
  const mcpPath = await runInteractiveSetup();

  if (mcpPath) {
    console.log("");
    console.log("✅ 설정이 완료되었습니다!");
    console.log("");
    console.log("이제 서버를 시작합니다...");
    console.log("");
    // 설정 완료 후 정상 서버 시작 (main 함수 호출)
    await main();
  } else {
    console.log("");
    console.log("설정이 취소되었습니다.");
    process.exit(0);
  }
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  try {
    // CLI 인수 확인
    const args = process.argv.slice(2);

    // --reset-config 인수 처리
    if (args.includes("--reset-config")) {
      handleResetConfig();
      return;
    }

    // --setup 또는 --reconfigure 인수 처리
    if (args.includes("--setup") || args.includes("--reconfigure")) {
      await handleSetup();
      return;
    }

    // 1. 설정 로드
    const config = loadConfig();

    // 2. 로거 초기화
    initLogger(config.logging.level, config.logging.file);
    const logger = getLogger();

    logger.info("Starting Copilot + Power BI Desktop MCP Bridge...");
    logger.debug("Configuration loaded", config);

    // 3. MCP 실행 파일 경로 확인
    const mcpCommand = await resolveCommand(config.mcp.command);

    // 4. MCP 클라이언트 초기화
    const mcpClient = new McpClient(
      mcpCommand,
      config.mcp.args,
      config.mcp.cwd,
      config.mcp.startupTimeoutMs,
      config.mcp.requestTimeoutMs
    );

    // 5. MCP 프로세스 시작
    try {
      await mcpClient.start();
      logger.info("MCP process started successfully");
    } catch (error) {
      logger.error(`Failed to start MCP process: ${error}`);
      logger.warn("Bridge will start, but MCP requests will fail until process is running");
    }

    // 6. Express 서버 생성
    const app = createServer(config, mcpClient);

    // 7. HTTP 서버 시작
    const server = http.createServer(app);

    server.listen(config.server.port, config.server.host, () => {
      printBanner(config.server.port, config.server.host, mcpClient.getCommand());
      logger.info(
        `Bridge server listening on http://${config.server.host}:${config.server.port}`
      );

      if (config.security.apiKey) {
        logger.info("API Key authentication enabled");
      } else {
        logger.warn("API Key authentication disabled (not recommended for production)");
      }
    });

    // 8. 시그널 핸들링
    process.on("SIGTERM", () => gracefulShutdown(server, mcpClient, "SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown(server, mcpClient, "SIGINT"));

    // 9. 에러 핸들링
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught exception:", error);
      gracefulShutdown(server, mcpClient, "uncaughtException");
    });

    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled rejection at:", promise, "reason:", reason);
    });

    // 10. 서버 에러 핸들링
    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        logger.error(
          `Port ${config.server.port} is already in use. Please use a different port.`
        );
      } else if (error.code === "EACCES") {
        logger.error(
          `Permission denied to bind to port ${config.server.port}. Try a port > 1024.`
        );
      } else {
        logger.error(`Server error: ${error.message}`);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to start bridge:", error);
    process.exit(1);
  }
}

// 엔트리 포인트
if (require.main === module) {
  main();
}

export { main };
