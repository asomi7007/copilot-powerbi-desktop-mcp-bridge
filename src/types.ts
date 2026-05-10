// JSON-RPC 2.0 기본 타입
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Bridge 설정
export interface BridgeConfig {
  server: {
    port: number;
    host: string;
  };
  mcp: {
    command: string;
    args: string[];
    cwd?: string;
    startupTimeoutMs: number;
    requestTimeoutMs: number;
  };
  security: {
    apiKey?: string;
    corsOrigins: string[];
  };
  logging: {
    level: string;
    file?: string;
  };
  filesystem: {
    enabled: boolean;
    // 파일 작업이 허용되는 디렉터리들의 절대 경로.
    // 비어있으면 인덱스에서 install-path/workspace를 자동 추가.
    allowedPaths: string[];
    maxFileSizeBytes: number;
    maxSearchResults: number;
  };
}

// MCP tool schema (tools/list 응답)
export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

// MCP tools/call 결과
export interface McpToolResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}

// MCP 프로세스 상태
export enum McpProcessState {
  STOPPED = "stopped",
  STARTING = "starting",
  RUNNING = "running",
  ERROR = "error"
}

// Health 응답
export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  bridge: {
    version: string;
    uptime: number;
  };
  mcp: {
    state: McpProcessState;
    pid?: number;
    command: string;
  };
  powerbi: {
    connected: boolean;
  };
}
