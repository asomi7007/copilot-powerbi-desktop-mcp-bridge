import { Router, Request, Response } from "express";
import { McpClient } from "../mcp-client";
import { JsonRpcRequest, McpProcessState } from "../types";
import { getLogger } from "../logger";
import {
  FILESYSTEM_TOOL_SCHEMAS,
  FilesystemToolHandler,
  isFilesystemTool,
} from "../filesystem-tools";

/**
 * MCP 라우트 생성
 */
export function createMcpRouter(
  mcpClient: McpClient,
  fsHandler?: FilesystemToolHandler
): Router {
  const router = Router();
  const logger = getLogger();

  /**
   * POST /mcp - JSON-RPC 요청을 MCP 프로세스로 전달
   */
  router.post("/", async (req: Request, res: Response) => {
    try {
      const request = req.body as JsonRpcRequest;

      // 요청 검증
      if (!request.jsonrpc || request.jsonrpc !== "2.0") {
        res.status(400).json({
          jsonrpc: "2.0",
          id: request.id || null,
          error: {
            code: -32600,
            message: "Invalid Request: jsonrpc must be '2.0'",
          },
        });
        return;
      }

      if (!request.method || typeof request.method !== "string") {
        res.status(400).json({
          jsonrpc: "2.0",
          id: request.id || null,
          error: {
            code: -32600,
            message: "Invalid Request: method is required",
          },
        });
        return;
      }

      if (request.id === undefined || request.id === null) {
        res.status(400).json({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32600,
            message: "Invalid Request: id is required",
          },
        });
        return;
      }

      // ─── 멀티 MCP 라우팅: tools/list와 tools/call의 filesystem 도구는 ───
      // ─── Power BI MCP 가동 여부와 무관하게 Bridge에서 직접 처리한다.   ───
      if (fsHandler && request.method === "tools/list") {
        let powerBiTools: unknown[] = [];
        if (mcpClient.getState() === McpProcessState.RUNNING) {
          try {
            const upstream = await mcpClient.sendRequest(request);
            const result = upstream.result as { tools?: unknown[] } | undefined;
            if (result && Array.isArray(result.tools)) powerBiTools = result.tools;
          } catch (e) {
            logger.warn(`tools/list passthrough to MCP failed: ${e instanceof Error ? e.message : e}`);
          }
        }
        res.json({
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: [...powerBiTools, ...FILESYSTEM_TOOL_SCHEMAS] },
        });
        return;
      }

      if (fsHandler && request.method === "tools/call") {
        const params = (request.params || {}) as { name?: string; arguments?: Record<string, unknown> };
        if (typeof params.name === "string" && isFilesystemTool(params.name)) {
          const fsArgs = (params.arguments && typeof params.arguments === "object")
            ? params.arguments
            : {};
          const result = await fsHandler.handle(params.name, fsArgs);
          res.json({ jsonrpc: "2.0", id: request.id, result });
          return;
        }
      }

      // MCP 프로세스 상태 확인
      const state = mcpClient.getState();
      if (state !== McpProcessState.RUNNING) {
        logger.warn(`MCP request rejected: process not running (state: ${state})`);
        res.status(502).json({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32001,
            message: "MCP process not running",
            data: { state },
          },
        });
        return;
      }

      // MCP 프로세스로 요청 전달
      try {
        const response = await mcpClient.sendRequest(request);
        res.json(response);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes("timeout")) {
            logger.error(`MCP request timeout: ${request.method} (id: ${request.id})`);
            res.status(504).json({
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: -32002,
                message: "MCP request timed out",
                data: { method: request.method },
              },
            });
          } else {
            logger.error(`MCP request error: ${error.message}`);
            res.status(502).json({
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: -32003,
                message: "MCP request failed",
                data: { details: error.message },
              },
            });
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error(`Unhandled error in MCP route: ${error}`);
      res.status(500).json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: "Internal server error",
        },
      });
    }
  });

  return router;
}
