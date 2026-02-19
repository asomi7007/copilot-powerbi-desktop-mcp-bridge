import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import * as dotenv from "dotenv";
import { BridgeConfig } from "./types";

// .env 파일 로드 시도
dotenv.config();

/**
 * 기본 설정값
 */
const DEFAULT_CONFIG: BridgeConfig = {
  server: {
    port: 5050,
    host: "127.0.0.1",
  },
  mcp: {
    command: "powerbi-modeling-mcp.exe",
    args: [],
    cwd: undefined,
    startupTimeoutMs: 10000,
    requestTimeoutMs: 30000,
  },
  security: {
    apiKey: undefined,
    corsOrigins: ["*"],
  },
  logging: {
    level: "info",
    file: undefined,
  },
};

/**
 * config.yaml 파일을 찾아서 로드
 * 현재 디렉토리 -> 실행 파일 디렉토리 순서로 탐색
 */
function loadConfigFile(): Partial<BridgeConfig> | null {
  const possiblePaths = [
    path.join(process.cwd(), "config.yaml"),
    path.join(process.cwd(), "config.yml"),
    path.join(__dirname, "../config.yaml"),
    path.join(__dirname, "../config.yml"),
  ];

  for (const configPath of possiblePaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, "utf8");
        const parsed = yaml.parse(content) as Partial<BridgeConfig>;
        console.log(`[Config] Loaded from: ${configPath}`);
        return parsed;
      } catch (error) {
        console.warn(`[Config] Failed to parse ${configPath}:`, error);
      }
    }
  }

  console.log("[Config] No config file found, using defaults and environment variables");
  return null;
}

/**
 * 환경 변수에서 설정 오버라이드
 */
function applyEnvironmentOverrides(config: BridgeConfig): void {
  if (process.env.BRIDGE_PORT) {
    config.server.port = parseInt(process.env.BRIDGE_PORT, 10);
  }
  if (process.env.BRIDGE_HOST) {
    config.server.host = process.env.BRIDGE_HOST;
  }
  if (process.env.MCP_COMMAND) {
    config.mcp.command = process.env.MCP_COMMAND;
  }
  if (process.env.MCP_CWD) {
    config.mcp.cwd = process.env.MCP_CWD;
  }
  if (process.env.API_KEY) {
    config.security.apiKey = process.env.API_KEY;
  }
  if (process.env.LOG_LEVEL) {
    config.logging.level = process.env.LOG_LEVEL;
  }
  if (process.env.LOG_FILE) {
    config.logging.file = process.env.LOG_FILE;
  }
}

/**
 * CLI 인수에서 설정 오버라이드
 */
function applyCliOverrides(config: BridgeConfig): void {
  const args = process.argv.slice(2);
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === "--port" && nextArg) {
      config.server.port = parseInt(nextArg, 10);
      i++;
    } else if (arg === "--host" && nextArg) {
      config.server.host = nextArg;
      i++;
    } else if (arg === "--mcp-command" && nextArg) {
      config.mcp.command = nextArg;
      i++;
    } else if (arg === "--mcp-cwd" && nextArg) {
      config.mcp.cwd = nextArg;
      i++;
    } else if (arg === "--api-key" && nextArg) {
      config.security.apiKey = nextArg;
      i++;
    } else if (arg === "--log-level" && nextArg) {
      config.logging.level = nextArg;
      i++;
    }
  }
}

/**
 * 깊은 병합 (객체의 중첩된 속성도 병합)
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];
      const targetValue = result[key];
      
      if (
        sourceValue &&
        typeof sourceValue === "object" &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === "object" &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue, sourceValue as any);
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue as any;
      }
    }
  }
  
  return result;
}

/**
 * 설정을 로드하고 우선순위에 따라 병합
 * 우선순위: CLI 인수 > 환경변수 > config.yaml > 기본값
 */
export function loadConfig(): BridgeConfig {
  // 1. 기본값으로 시작
  let config: BridgeConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // 2. config.yaml 병합
  const fileConfig = loadConfigFile();
  if (fileConfig) {
    config = deepMerge(config, fileConfig);
  }

  // 3. 환경 변수 오버라이드
  applyEnvironmentOverrides(config);

  // 4. CLI 인수 오버라이드
  applyCliOverrides(config);

  return config;
}
