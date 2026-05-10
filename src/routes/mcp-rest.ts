import { Router, Request, Response } from "express";
import { McpClient } from "../mcp-client";
import { McpProcessState, JsonRpcResponse } from "../types";
import { getLogger } from "../logger";
import {
  FILESYSTEM_TOOL_SCHEMAS,
  FilesystemToolHandler,
  isFilesystemTool,
} from "../filesystem-tools";

/**
 * toolArguments를 다양한 입력 형식에서 안전하게 파싱합니다.
 *
 * 지원 형식:
 * - JSON 문자열: '{"request":{"operation":"List"}}'
 * - 이중 인코딩된 JSON 문자열: '"{\\"request\\":{\\"operation\\":\\"List\\"}}"'
 * - 객체: { request: { operation: "List" } }
 * - null/undefined/빈 문자열: {} 로 처리
 */
function parseToolArguments(
  toolArguments: unknown,
  toolName: string
): { success: true; args: Record<string, unknown> } | { success: false; error: string } {
  const logger = getLogger();

  // null, undefined, 빈 문자열 → 도구별 기본값 제공
  if (toolArguments === null || toolArguments === undefined) {
    logger.debug(`parseToolArguments: input is null/undefined for tool '${toolName}', providing default request structure`);
    return { success: true, args: getDefaultArgumentsForTool(toolName) };
  }

  if (typeof toolArguments === "string") {
    const trimmed = toolArguments.trim();

    // 빈 문자열 → 도구별 기본값 제공
    if (trimmed === "") {
      logger.debug(`parseToolArguments: input is empty string for tool '${toolName}', providing default request structure`);
      return { success: true, args: getDefaultArgumentsForTool(toolName) };
    }

    try {
      const parsed = JSON.parse(trimmed);

      // 이중 인코딩 처리: JSON.parse 결과가 여전히 문자열이면 한번 더 파싱
      if (typeof parsed === "string") {
        logger.debug("parseToolArguments: detected double-encoded JSON string, parsing again");
        try {
          const doubleParsed = JSON.parse(parsed);
          if (typeof doubleParsed === "object" && doubleParsed !== null && !Array.isArray(doubleParsed)) {
            logger.debug(`parseToolArguments: double-parsed result: ${JSON.stringify(doubleParsed)}`);
            return { success: true, args: doubleParsed as Record<string, unknown> };
          }
          return { success: false, error: "Double-parsed toolArguments is not a valid object" };
        } catch {
          return { success: false, error: "Double-encoded toolArguments is not valid JSON" };
        }
      }

      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        logger.debug(`parseToolArguments: parsed from string: ${JSON.stringify(parsed)}`);
        return { success: true, args: parsed as Record<string, unknown> };
      }

      return { success: false, error: "toolArguments JSON must be an object, not array or primitive" };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `toolArguments is not valid JSON: ${errMsg}` };
    }
  }

  if (typeof toolArguments === "object" && !Array.isArray(toolArguments)) {
    // 빈 객체({})도 기본값으로 폴백 — Copilot Studio가 빈 객체를 보내는 경우
    if (Object.keys(toolArguments as Record<string, unknown>).length === 0) {
      logger.debug(`parseToolArguments: empty object received for tool '${toolName}', using defaults`);
      return { success: true, args: getDefaultArgumentsForTool(toolName) };
    }
    logger.debug(`parseToolArguments: input is already an object: ${JSON.stringify(toolArguments)}`);
    return { success: true, args: toolArguments as Record<string, unknown> };
  }

  return { success: false, error: `toolArguments has unsupported type: ${typeof toolArguments}` };
}

/**
 * 도구별 기본 arguments 구조를 제공합니다.
 * Copilot Studio가 toolArguments를 보내지 않을 때 사용됩니다.
 */
function getDefaultArgumentsForTool(toolName: string): Record<string, unknown> {
  switch (toolName) {
    case "table_operations":
      return { request: { operation: "List" } };
    
    case "dax_query_operations":
      return {
        request: {
          operation: "Execute",
          query: "EVALUATE INFO.TABLES()"
        }
      };
    
    case "column_operations":
      return {
        request: {
          operation: "List"
        }
      };
    
    case "measure_operations":
      return {
        request: {
          operation: "List"
        }
      };
    
    case "relationship_operations":
      return { request: { operation: "List" } };
    
    case "batch_measure_operations":
      return {
        request: {
          operation: "List"
        }
      };
    
    case "batch_column_operations":
      return {
        request: {
          operation: "List"
        }
      };
    
    case "batch_table_operations":
      return {
        request: {
          operations: []
        }
      };
    
    case "partition_operations":
      return {
        request: {
          operation: "List"
        }
      };
    
    case "connection_operations":
      return { request: { operation: "ListConnections" } };
    
    default:
      // 알려지지 않은 도구에 대한 기본값
      return { request: { operation: "List" } };
  }
}

/**
 * MCP 응답에서 Power BI Desktop 연결 관련 에러인지 감지합니다.
 * JSON-RPC error와 result.content 텍스트 양쪽 모두 확인합니다.
 */
function isConnectionError(response: JsonRpcResponse): boolean {
  const connectionErrorPatterns = [
    "no connectionname provided",
    "no last used connection",
    "not connected",
    "connection not found",
    "no active connection",
    "connect to a power bi",
    "establish a connection first",
  ];

  // JSON-RPC error.message 확인
  if (response.error?.message) {
    const msg = response.error.message.toLowerCase();
    if (connectionErrorPatterns.some((p) => msg.includes(p))) {
      return true;
    }
  }

  // JSON-RPC error.data 확인 (문자열인 경우)
  if (response.error?.data && typeof response.error.data === "string") {
    const data = response.error.data.toLowerCase();
    if (connectionErrorPatterns.some((p) => data.includes(p))) {
      return true;
    }
  }

  // result.content[].text 확인 (성공 응답이지만 에러 내용이 담긴 경우)
  if (response.result) {
    const result = response.result as { content?: Array<{ type?: string; text?: string }> };
    if (result.content && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.text && typeof item.text === "string") {
          const text = item.text.toLowerCase();
          if (connectionErrorPatterns.some((p) => text.includes(p))) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * MCP 응답의 result.content[].text에 에러가 포함되어 있는지 감지합니다.
 * MCP 서버는 에러를 HTTP 200 + result.content[].text에 담아 반환하는 경우가 있습니다.
 */
function isResultContainingError(response: any): { hasError: boolean; errorText?: string } {
  if (!response.result) return { hasError: false };
  
  const result = response.result as { content?: Array<{ type?: string; text?: string }>, isError?: boolean };
  
  // MCP 서버가 isError 플래그를 설정한 경우 (확실한 에러)
  if (result.isError === true) {
    const text = result.content?.map((c: any) => c.text).join('\n') || 'Unknown error';
    return { hasError: true, errorText: text };
  }
  
  // content[].text에서 MCP 응답 JSON 파싱하여 success:false 체크
  if (result.content && Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.text && typeof item.text === 'string') {
        try {
          const parsed = JSON.parse(item.text);
          if (parsed.success === false) {
            return { hasError: true, errorText: item.text };
          }
        } catch {
          // JSON 파싱 실패 시 텍스트 패턴 매칭 (폴백)
          // "success":false 패턴 확인
          if (item.text.includes('"success":false') || item.text.includes('"success": false')) {
            return { hasError: true, errorText: item.text };
          }
        }
      }
    }
  }
  
  return { hasError: false };
}

/**
 * operation별 필수 파라미터가 올바르게 전달되었는지 검증합니다.
 * 누락된 경우 경고를 반환하지만, 요청 자체를 차단하지는 않습니다.
 */
function validateOperationArguments(toolName: string, args: Record<string, unknown>):
  { valid: boolean; operation?: string; missingFields: string[] } {
  const request = args?.request as Record<string, unknown> | undefined;
  if (!request) return { valid: false, missingFields: ['request'] };
  
  const operation = request.operation as string | undefined;
  if (!operation) return { valid: false, missingFields: ['request.operation'] };
  
  const missing: string[] = [];
  
  if (toolName === 'relationship_operations') {
    if (operation === 'Create') {
      // relationshipDefinition이 있거나, flat 파라미터(fromTable 등)가 있으면 OK
      if (!request.relationshipDefinition && !request.fromTable) {
        missing.push('request.relationshipDefinition or flat params (request.fromTable, request.fromColumn, request.toTable, request.toColumn)');
      }
    }
    if (operation === 'Update') {
      if (!request.relationshipName) missing.push('request.relationshipName');
      if (!request.relationshipUpdate && !request.crossFilteringBehavior && request.isActive === undefined && !request.securityFilteringBehavior) {
        missing.push('request.relationshipUpdate or flat params (request.crossFilteringBehavior, request.isActive, etc.)');
      }
    }
    if (operation === 'Delete' && !request.relationshipName) {
      missing.push('request.relationshipName');
    }
  }
  
  if (toolName === 'dax_query_operations') {
    if (operation === 'Execute' && !request.query) {
      missing.push('request.query (DAX query string is required)');
    }
  }
  
  if (toolName === 'measure_operations') {
    if (operation === 'Create') {
      if (!request.tableName) missing.push('request.tableName');
      if (!request.name) missing.push('request.name');
      if (!request.expression) missing.push('request.expression');
    }
  }
  
  if (toolName === 'column_operations') {
    if (operation === 'List' && !request.tableName) {
      missing.push('request.tableName');
    }
  }

  if (toolName === 'partition_operations') {
    if (operation === 'Update') {
      if (!request.tableName && !request.partitionName) missing.push('request.tableName, request.partitionName');
      if (!request.updateDefinition && !request.expression) {
        missing.push('request.updateDefinition or request.expression (M expression for the partition)');
      }
    }
    if (operation === 'Create') {
      if (!request.tableName) missing.push('request.tableName');
      if (!request.createDefinition && !request.expression) {
        missing.push('request.createDefinition or request.expression');
      }
    }
    if (operation === 'Delete' || operation === 'Refresh' || operation === 'Get') {
      if (!request.tableName) missing.push('request.tableName');
      if (!request.partitionName) missing.push('request.partitionName');
    }
  }

  if (toolName === 'table_operations') {
    if (operation === 'Create') {
      if (!request.createDefinition && !request.tableName) {
        missing.push('request.createDefinition or request.tableName');
      }
    }
    if (operation === 'Update' || operation === 'Delete' || operation === 'Refresh' || operation === 'Get' || operation === 'Rename') {
      if (!request.tableName) missing.push('request.tableName');
    }
    if (operation === 'Rename') {
      if (!request.newName) missing.push('request.newName');
    }
  }
  
  return { valid: missing.length === 0, operation, missingFields: missing };
}

/**
 * Flat 파라미터를 MCP 서버가 기대하는 Nested 구조로 변환합니다.
 * Copilot Studio는 Swagger에 명시된 flat 속성만 전달할 수 있으므로,
 * Bridge에서 createDefinition/updateDefinition 등의 중첩 구조로 재구성합니다.
 */
function transformFlatToNestedArguments(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const request = args?.request as Record<string, unknown> | undefined;
  if (!request || !request.operation) return args;

  const operation = (request.operation as string).toLowerCase();
  const transformed = { ...args, request: { ...request } };
  const req = transformed.request as Record<string, unknown>;

  /** Helper: build an object from flat keys, removing them from req */
  function extractFlat(keys: string[], keyMap?: Record<string, string>): Record<string, unknown> | null {
    const obj: Record<string, unknown> = {};
    let hasAny = false;
    for (const key of keys) {
      const val = req[key];
      if (val !== undefined) {
        const targetKey = keyMap?.[key] ?? key;
        obj[targetKey] = val;
        hasAny = true;
      }
    }
    if (!hasAny) return null;
    // remove extracted keys from req
    for (const key of keys) {
      if (req[key] !== undefined) delete req[key];
    }
    return obj;
  }

  // ─── relationship_operations ───
  // MCP 서버는 relationshipDefinition (Create)과 relationshipUpdate (Update)를 기대합니다.
  // 다른 도구들(table/measure/partition)은 createDefinition/updateDefinition을 사용하지만,
  // relationship_operations만 다른 키 이름을 사용합니다.
  if (toolName === 'relationship_operations') {
    if (operation === 'create' && !req.relationshipDefinition) {
      const flatKeys = ['fromTable', 'fromColumn', 'toTable', 'toColumn', 'crossFilteringBehavior', 'isActive', 'securityFilteringBehavior'];
      if (req.fromTable || req.fromColumn || req.toTable || req.toColumn) {
        const def = extractFlat(flatKeys);
        if (def) req.relationshipDefinition = def;
      }
    }
    if (operation === 'update' && !req.relationshipUpdate) {
      const flatKeys = ['crossFilteringBehavior', 'isActive', 'securityFilteringBehavior'];
      if (req.crossFilteringBehavior || req.isActive !== undefined || req.securityFilteringBehavior) {
        const def = extractFlat(flatKeys);
        if (def) req.relationshipUpdate = def;
      }
    }
  }

  // ─── partition_operations ───
  if (toolName === 'partition_operations') {
    if (operation === 'update' && !req.updateDefinition) {
      if (req.expression || req.sourceType || req.mode || req.description) {
        const def = extractFlat(['expression', 'sourceType', 'mode', 'description']);
        if (def) req.updateDefinition = def;
      }
    }
    if (operation === 'create' && !req.createDefinition) {
      if (req.expression || req.sourceType || req.mode) {
        // partitionName → name in createDefinition
        const def = extractFlat(['partitionName', 'expression', 'sourceType', 'mode'], { partitionName: 'name' });
        if (def) req.createDefinition = def;
      }
    }
  }

  // ─── table_operations ───
  if (toolName === 'table_operations') {
    if (operation === 'create' && !req.createDefinition) {
      if (req.tableName || req.columns || req.partitions) {
        // columns와 partitions가 JSON 문자열일 수 있으므로 파싱 시도
        if (typeof req.columns === 'string') {
          try { req.columns = JSON.parse(req.columns as string); } catch { /* keep as-is */ }
        }
        if (typeof req.partitions === 'string') {
          try { req.partitions = JSON.parse(req.partitions as string); } catch { /* keep as-is */ }
        }
        // tableName → name in createDefinition
        const def = extractFlat(['tableName', 'columns', 'partitions', 'description'], { tableName: 'name' });
        if (def) req.createDefinition = def;
        // tableName은 createDefinition.name에 매핑되었지만, 기존 위치에도 유지하려면 복원
        // (extractFlat이 이미 삭제했으므로 원래 값을 복원)
        if (request.tableName) req.tableName = request.tableName;
      }
    }
    if (operation === 'update' && !req.updateDefinition) {
      if (req.description !== undefined || req.isHidden !== undefined) {
        const def = extractFlat(['description', 'isHidden']);
        if (def) req.updateDefinition = def;
      }
    }
  }

  // ─── measure_operations ───
  if (toolName === 'measure_operations') {
    if (operation === 'update' && !req.updateDefinition) {
      if (req.expression || req.description !== undefined || req.formatString || req.displayFolder || req.isHidden !== undefined) {
        const def = extractFlat(['expression', 'description', 'formatString', 'displayFolder', 'isHidden']);
        if (def) req.updateDefinition = def;
      }
    }
  }

  return transformed;
}

/**
 * 로컬 Power BI Desktop 인스턴스를 자동으로 찾아 연결합니다.
 *
 * 순서:
 * 1. connection_operations의 ListLocalInstances로 로컬 인스턴스 목록 조회
 * 2. 인스턴스가 있으면 첫 번째 인스턴스의 포트로 Connect 수행
 *
 * @returns 연결 성공 여부
 */
async function attemptAutoConnect(mcpClient: McpClient): Promise<boolean> {
  const logger = getLogger();
  logger.info("🔄 자동 연결 시도: 로컬 Power BI Desktop 인스턴스를 검색합니다...");

  try {
    // Step 1: ListLocalInstances 호출
    const listRequest = {
      jsonrpc: "2.0" as const,
      id: `auto-list-${Date.now()}`,
      method: "tools/call",
      params: {
        name: "connection_operations",
        arguments: { request: { operation: "ListLocalInstances" } },
      },
    };

    const listResponse = await mcpClient.sendRequest(listRequest);

    if (listResponse.error) {
      logger.warn(`자동 연결: ListLocalInstances 실패 - ${listResponse.error.message}`);
      return false;
    }

    // 응답에서 포트 번호 추출
    const port = extractPortFromResponse(listResponse);
    if (!port) {
      logger.warn("자동 연결: 로컬 Power BI Desktop 인스턴스를 찾지 못했습니다.");
      return false;
    }

    logger.info(`자동 연결: Power BI Desktop 인스턴스 발견 (port: ${port}), 연결 시도 중...`);

    // Step 2: Connect 호출 (ConnectionString 형식 사용)
    const connectionString = `Provider=MSOLAP;Data Source=localhost:${port}`;
    logger.info(`자동 연결: ConnectionString='${connectionString}'`);
    
    const connectRequest = {
      jsonrpc: "2.0" as const,
      id: `auto-connect-${Date.now()}`,
      method: "tools/call",
      params: {
        name: "connection_operations",
        arguments: {
          request: {
            operation: "Connect",
            ConnectionString: connectionString,
          },
        },
      },
    };

    const connectResponse = await mcpClient.sendRequest(connectRequest);

    if (connectResponse.error) {
      logger.warn(`자동 연결: Connect 실패 - ${connectResponse.error.message}`);
      return false;
    }

    // Connect 결과 검증 - 성공 응답인지 확인
    const connectResult = connectResponse.result as { content?: Array<{ text?: string }> } | undefined;
    if (connectResult?.content) {
      for (const item of connectResult.content) {
        if (item.text) {
          const text = item.text.toLowerCase();
          if (text.includes("error") || text.includes("failed") || text.includes("unable")) {
            logger.warn(`자동 연결: Connect 응답에 에러 포함 - ${item.text}`);
            return false;
          }
        }
      }
    }

    logger.info(`✅ 자동 연결 성공: Power BI Desktop (port: ${port})에 연결되었습니다.`);
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`자동 연결 실패: ${errorMsg}`);
    return false;
  }
}

/**
 * ListLocalInstances 응답에서 첫 번째 인스턴스의 포트 번호를 추출합니다.
 *
 * 응답 형식 예시 (content[0].text):
 * - JSON 배열: [{"port": 12345, ...}]
 * - 텍스트: "Port: 12345" 등
 */
function extractPortFromResponse(response: JsonRpcResponse): number | null {
  const logger = getLogger();

  const result = response.result as { content?: Array<{ text?: string }> } | undefined;
  if (!result?.content || !Array.isArray(result.content)) {
    return null;
  }

  for (const item of result.content) {
    if (!item.text || typeof item.text !== "string") continue;

    const text = item.text.trim();
    logger.debug(`자동 연결: ListLocalInstances 응답 파싱 중: ${text.substring(0, 200)}...`);

    // Case 1: JSON 형식으로 파싱 시도
    try {
      const parsed = JSON.parse(text);

      // 배열인 경우: [{ port: 12345, ... }, ...]
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0];
        if (first.port && typeof first.port === "number") {
          return first.port;
        }
        // "Port" 키 대소문자 변형
        if (first.Port && typeof first.Port === "number") {
          return first.Port;
        }
      }

      // 단일 객체인 경우: { port: 12345, ... }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (parsed.port && typeof parsed.port === "number") {
          return parsed.port;
        }
        if (parsed.Port && typeof parsed.Port === "number") {
          return parsed.Port;
        }
        // instances 키 안에 배열이 있는 경우
        if (parsed.instances && Array.isArray(parsed.instances) && parsed.instances.length > 0) {
          const inst = parsed.instances[0];
          if (inst.port) return Number(inst.port);
          if (inst.Port) return Number(inst.Port);
        }
      }
    } catch {
      // JSON 파싱 실패 → 텍스트 기반 추출 시도
    }

    // Case 2: 정규식으로 포트 번호 추출 (텍스트 응답)
    // "port: 12345" 또는 "Port=12345" 또는 "localhost:12345" 등
    const portPatterns = [
      /port[:\s=]+(\d{4,5})/i,
      /localhost:(\d{4,5})/i,
      /127\.0\.0\.1:(\d{4,5})/i,
      /(\d{4,5})\s*[-–]\s*power\s*bi/i,
    ];

    for (const pattern of portPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const port = parseInt(match[1], 10);
        if (port > 1023 && port < 65536) {
          return port;
        }
      }
    }
  }

  return null;
}

export function createMcpRestRouter(
  mcpClient: McpClient,
  fsHandler?: FilesystemToolHandler
): Router {
  const router = Router();
  const logger = getLogger();

  // 자동 연결 상태 추적
  let autoConnected = false;
  let autoConnectInProgress = false;

  // MCP 프로세스 상태 확인 헬퍼
  function checkMcpRunning(req: Request, res: Response): boolean {
    const state = mcpClient.getState();
    if (state !== McpProcessState.RUNNING) {
      logger.warn(`MCP REST request rejected: process not running (state: ${state})`);
      res.status(502).json({
        error: { code: -32001, message: "MCP process not running", data: { state } },
      });
      return false;
    }
    return true;
  }

  /**
   * 자동 연결 보장: 연결이 안 되어 있으면 자동으로 로컬 Power BI Desktop에 연결합니다.
   * 이미 연결되어 있으면 즉시 true를 반환합니다.
   *
   * @returns 연결 준비 완료 여부
   */
  async function ensureConnected(): Promise<boolean> {
    // 이미 자동 연결 성공 상태면 스킵
    if (autoConnected) return true;

    // 동시 자동 연결 방지
    if (autoConnectInProgress) {
      logger.debug("자동 연결이 이미 진행 중입니다. 대기...");
      // 짧게 대기 후 상태 확인
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return autoConnected;
    }

    autoConnectInProgress = true;
    try {
      // 먼저 현재 연결 상태 확인
      const statusRequest = {
        jsonrpc: "2.0" as const,
        id: `auto-status-${Date.now()}`,
        method: "tools/call",
        params: {
          name: "connection_operations",
          arguments: { request: { operation: "Status" } },
        },
      };

      const statusResponse = await mcpClient.sendRequest(statusRequest);

      // 이미 연결되어 있는지 확인
      if (!isConnectionError(statusResponse) && !statusResponse.error) {
        const statusResult = statusResponse.result as { content?: Array<{ text?: string }> } | undefined;
        if (statusResult?.content) {
          for (const item of statusResult.content) {
            if (item.text && typeof item.text === "string") {
              const text = item.text.toLowerCase();
              // "connected" 키워드가 있고 에러가 아니면 이미 연결됨
              if (text.includes("connected") && !text.includes("not connected") && !text.includes("no connection")) {
                logger.info("Power BI Desktop에 이미 연결되어 있습니다.");
                autoConnected = true;
                return true;
              }
            }
          }
        }
      }

      // 연결 안 됨 → 자동 연결 시도
      const connected = await attemptAutoConnect(mcpClient);
      if (connected) {
        autoConnected = true;
      }
      return connected;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`ensureConnected 실패: ${errorMsg}`);
      return false;
    } finally {
      autoConnectInProgress = false;
    }
  }

  /**
   * POST /mcp/tools/list - 사용 가능한 도구 목록 조회
   * 파라미터 없음
   */
  router.post("/tools/list", async (req: Request, res: Response) => {
    try {
      // Power BI MCP 도구 (프로세스가 살아있을 때만; 죽어있으면 빈 배열로 폴백)
      let powerBiTools: unknown[] = [];
      if (mcpClient.getState() === McpProcessState.RUNNING) {
        const jsonRpcRequest = {
          jsonrpc: "2.0" as const,
          id: `rest-list-${Date.now()}`,
          method: "tools/list",
          params: {},
        };
        const response = await mcpClient.sendRequest(jsonRpcRequest);
        if (response.error) {
          logger.warn(`MCP tools/list returned error: ${JSON.stringify(response.error)} — proceeding with filesystem tools only`);
        } else {
          const result = response.result as { tools?: unknown[] } | undefined;
          if (result && Array.isArray(result.tools)) powerBiTools = result.tools;
        }
      } else {
        logger.warn(`Power BI MCP not running (state: ${mcpClient.getState()}) — returning filesystem tools only`);
      }

      // Filesystem 도구 (Bridge 내장)
      const fsTools = fsHandler ? FILESYSTEM_TOOL_SCHEMAS : [];

      res.json({ tools: [...powerBiTools, ...fsTools] });
    } catch (error) {
      logger.error(`MCP REST tools/list error: ${error}`);
      res.status(500).json({ error: { code: -32603, message: "Internal server error" } });
    }
  });

  /**
   * POST /mcp/tools/call - 특정 도구 실행
   * Body: { toolName: string, toolArguments?: string | object }
   *
   * 자동 연결 기능:
   * - Power BI Desktop 연결이 없으면 로컬 인스턴스를 자동으로 찾아 연결합니다.
   * - 연결 에러 발생 시 자동 재시도합니다.
   *
   * toolArguments 지원 형식:
   * - JSON 문자열: '{"request":{"operation":"List"}}'
   * - 객체: { request: { operation: "List" } }
   * - 빈 값/null/undefined: 빈 객체로 처리
   */
  router.post("/tools/call", async (req: Request, res: Response) => {
    try {
      const { toolName, toolArguments } = req.body;

      // ─── Copilot Studio 디버깅: raw toolArguments 상세 로깅 ───
      logger.info(`[TOOL CALL] toolName='${toolName}', toolArguments type='${typeof toolArguments}', value=${JSON.stringify(toolArguments)?.substring(0, 300) ?? "undefined"}`);

      if (!toolName || typeof toolName !== "string") {
        res.status(400).json({
          error: { code: -32602, message: "toolName is required and must be a string" },
        });
        return;
      }

      // ─── 멀티 MCP 라우팅: filesystem 도구는 Bridge가 직접 처리 ───
      if (fsHandler && isFilesystemTool(toolName)) {
        const fsArgs =
          toolArguments && typeof toolArguments === "object" && !Array.isArray(toolArguments)
            ? (toolArguments as Record<string, unknown>)
            : typeof toolArguments === "string" && toolArguments.length > 0
            ? (() => {
                try { return JSON.parse(toolArguments) as Record<string, unknown>; }
                catch { return {}; }
              })()
            : {};
        logger.info(`[FS TOOL] '${toolName}' args=${JSON.stringify(fsArgs).substring(0, 300)}`);
        const result = await fsHandler.handle(toolName, fsArgs);
        res.json(result);
        return;
      }

      // 이하 Power BI MCP 도구 흐름 — MCP 프로세스 가동 확인
      if (!checkMcpRunning(req, res)) return;

      // 다양한 형식의 toolArguments를 안전하게 파싱
      const parseResult = parseToolArguments(toolArguments, toolName);
      if (!parseResult.success) {
        logger.warn(`Failed to parse toolArguments for tool '${toolName}': ${parseResult.error}`);
        res.status(400).json({
          error: { code: -32602, message: parseResult.error },
        });
        return;
      }
      const parsedArguments = parseResult.args;
      
      // 기본값 폴백 여부 추적 (응답에 경고 포함용)
      const usedDefaultArgs = toolArguments === null
        || toolArguments === undefined
        || toolArguments === ""
        || (typeof toolArguments === "object" && toolArguments !== null
            && !Array.isArray(toolArguments) && Object.keys(toolArguments as Record<string, unknown>).length === 0);
      
      // Copilot Studio 호환성: toolArguments가 없었을 경우 기본값을 사용했음을 기록
      if (usedDefaultArgs) {
        logger.warn(`⚠️ Using DEFAULT arguments for tool '${toolName}' because toolArguments was ${toolArguments === null ? "null" : toolArguments === undefined ? "undefined" : "empty string"}. Copilot Studio may not be sending toolArguments correctly. Default: ${JSON.stringify(parsedArguments)}`);
      }

      // ─── 수정 4: operation별 필수 파라미터 검증 ───
      const validation = validateOperationArguments(toolName, parsedArguments);
      let validationWarning: { operation?: string; missingFields: string[] } | null = null;
      if (!validation.valid && validation.missingFields.length > 0) {
        logger.warn(`⚠️ Missing required parameters for ${toolName}/${validation.operation || 'unknown'}: ${validation.missingFields.join(', ')}`);
        validationWarning = { operation: validation.operation, missingFields: validation.missingFields };
      }

      // ─── 자동 연결 보장 (connection_operations 자체 호출 시에는 스킵) ───
      if (toolName !== "connection_operations") {
        await ensureConnected();
      }

      // ─── Flat → Nested 변환 적용 ───
      const transformedArguments = transformFlatToNestedArguments(toolName, parsedArguments as Record<string, unknown>);

      const jsonRpcRequest = {
        jsonrpc: "2.0" as const,
        id: `rest-call-${Date.now()}`,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: transformedArguments,
        },
      };

      logger.debug(
        `MCP REST tools/call: tool='${toolName}', arguments=${JSON.stringify(transformedArguments)}`
      );

      // ─── MCP 요청 info 레벨 로깅 (원본 + 변환 후) ───
      logger.info(`[MCP REQUEST] tool='${toolName}', originalArgs=${JSON.stringify(parsedArguments).substring(0, 300)}, transformedArgs=${JSON.stringify(transformedArguments).substring(0, 500)}`);

      let response = await mcpClient.sendRequest(jsonRpcRequest);

      // ─── MCP 응답 info 레벨 로깅 ───
      logger.info(`[MCP RESPONSE] tool='${toolName}', response=${JSON.stringify(response).substring(0, 500)}`);

      // ─── 연결 에러 감지 시 자동 재연결 및 재시도 ───
      if (toolName !== "connection_operations" && isConnectionError(response)) {
        logger.warn(`도구 '${toolName}' 연결 에러 감지. 자동 재연결을 시도합니다...`);
        
        // 연결 상태 초기화 후 재시도
        autoConnected = false;
        const reconnected = await ensureConnected();

        if (reconnected) {
          logger.info(`재연결 성공. 도구 '${toolName}'을 다시 호출합니다.`);
          const retryRequest = {
            jsonrpc: "2.0" as const,
            id: `rest-call-retry-${Date.now()}`,
            method: "tools/call",
            params: {
              name: toolName,
              arguments: transformedArguments,
            },
          };
          response = await mcpClient.sendRequest(retryRequest);
        } else {
          logger.error("자동 재연결 실패. 원래 에러를 반환합니다.");
        }
      }

      // JSON-RPC 래핑 제거
      if (response.error) {
        const errorDetail = JSON.stringify(response.error);
        logger.error(
          `MCP tools/call '${toolName}' returned error: ${errorDetail}`
        );
        
        // MCP 서버 에러를 더 명확하게 전달
        const errorMessage = response.error.message || "Unknown MCP server error";
        const errorData = response.error.data;
        
        res.status(400).json({
          error: {
            code: response.error.code,
            message: errorMessage,
            data: errorData,
            toolName: toolName,
            arguments: parsedArguments,
            hint: `Tool '${toolName}' requires specific arguments structure. Check the tool documentation.`
          },
          detail: `MCP server returned an error for tool '${toolName}'. This usually means the arguments structure is incorrect or missing required parameters.`
        });
      } else {
        const result = response.result || {};
        
        // ─── 수정 1: MCP 응답 내 에러 감지 ───
        const errorCheck = isResultContainingError(response);
        if (errorCheck.hasError) {
          logger.warn(`⚠️ [MCP RESULT ERROR] tool='${toolName}': MCP returned HTTP 200 but result contains error: ${errorCheck.errorText?.substring(0, 300)}`);
        }

        // 응답 객체 구성
        const responsePayload: Record<string, unknown> = { ...result as Record<string, unknown> };

        // 에러가 감지된 경우 메타데이터 추가
        if (errorCheck.hasError) {
          responsePayload._bridge_error_detected = {
            message: "MCP server returned success (HTTP 200) but the result content contains an error.",
            errorText: errorCheck.errorText,
            suggestion: `Check the tool arguments for '${toolName}'. Ensure all required parameters are provided correctly.`,
          };
        }

        // 수정 4: 검증 경고가 있는 경우 메타데이터 추가
        if (validationWarning) {
          responsePayload._bridge_validation_warning = {
            message: `Missing required parameters for ${toolName}/${validationWarning.operation || 'unknown'}`,
            missingFields: validationWarning.missingFields,
            suggestion: "Ensure Copilot Studio sends all required fields in toolArguments.",
          };
        }

        // 기본값 폴백이 사용된 경우, 응답에 경고 메타데이터를 추가
        if (usedDefaultArgs) {
          responsePayload._bridge_warning = {
            message: `toolArguments was not provided (was ${toolArguments === null ? "null" : toolArguments === undefined ? "undefined" : "empty string"}). Used default arguments: ${JSON.stringify(parsedArguments)}. If you intended a different operation (e.g., Delete, Create), ensure Copilot Studio sends toolArguments correctly. Check that the latest Swagger (with toolArguments type: "object") is uploaded to Power Platform.`,
            defaultArgumentsUsed: parsedArguments,
            receivedToolArguments: toolArguments ?? null,
          };
        }

        res.json(responsePayload);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("timeout")) {
        res.status(504).json({ error: { code: -32002, message: "MCP request timed out" } });
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`MCP REST tools/call error for '${req.body?.toolName}': ${errorMsg}`);
        res.status(500).json({
          error: { code: -32603, message: "Internal server error", data: { detail: errorMsg } },
        });
      }
    }
  });

  return router;
}