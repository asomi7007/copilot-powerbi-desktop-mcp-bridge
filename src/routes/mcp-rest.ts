import { Router, Request, Response } from "express";
import { McpClient } from "../mcp-client";
import { McpProcessState, JsonRpcResponse } from "../types";
import { getLogger } from "../logger";

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

export function createMcpRestRouter(mcpClient: McpClient): Router {
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
      if (!checkMcpRunning(req, res)) return;

      const jsonRpcRequest = {
        jsonrpc: "2.0" as const,
        id: `rest-list-${Date.now()}`,
        method: "tools/list",
        params: {},
      };

      const response = await mcpClient.sendRequest(jsonRpcRequest);
      
      // JSON-RPC 래핑 제거, result만 반환
      if (response.error) {
        logger.error(`MCP tools/list returned error: ${JSON.stringify(response.error)}`);
        res.status(400).json({ error: response.error });
      } else {
        res.json(response.result || { tools: [] });
      }
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
      if (!checkMcpRunning(req, res)) return;

      const { toolName, toolArguments } = req.body;

      // ─── Copilot Studio 디버깅: raw toolArguments 상세 로깅 ───
      logger.info(`[TOOL CALL] toolName='${toolName}', toolArguments type='${typeof toolArguments}', value=${JSON.stringify(toolArguments)?.substring(0, 300) ?? "undefined"}`);

      if (!toolName || typeof toolName !== "string") {
        res.status(400).json({
          error: { code: -32602, message: "toolName is required and must be a string" },
        });
        return;
      }

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

      // ─── 자동 연결 보장 (connection_operations 자체 호출 시에는 스킵) ───
      if (toolName !== "connection_operations") {
        await ensureConnected();
      }

      const jsonRpcRequest = {
        jsonrpc: "2.0" as const,
        id: `rest-call-${Date.now()}`,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: parsedArguments,
        },
      };

      logger.debug(
        `MCP REST tools/call: tool='${toolName}', arguments=${JSON.stringify(parsedArguments)}`
      );

      let response = await mcpClient.sendRequest(jsonRpcRequest);

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
              arguments: parsedArguments,
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
        
        // 기본값 폴백이 사용된 경우, 응답에 경고 메타데이터를 추가
        if (usedDefaultArgs) {
          res.json({
            ...result as Record<string, unknown>,
            _bridge_warning: {
              message: `toolArguments was not provided (was ${toolArguments === null ? "null" : toolArguments === undefined ? "undefined" : "empty string"}). Used default arguments: ${JSON.stringify(parsedArguments)}. If you intended a different operation (e.g., Delete, Create), ensure Copilot Studio sends toolArguments correctly. Check that the latest Swagger (with toolArguments type: "object") is uploaded to Power Platform.`,
              defaultArgumentsUsed: parsedArguments,
              receivedToolArguments: toolArguments ?? null,
            },
          });
        } else {
          res.json(result);
        }
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