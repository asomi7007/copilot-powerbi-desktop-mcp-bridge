import { Router, Request, Response } from "express";
import { McpClient } from "../mcp-client";
import { HealthResponse, McpProcessState } from "../types";
import { getLogger } from "../logger";

const bridgeStartTime = Date.now();
const version = "1.0.0";

/**
 * Health 라우트 생성
 */
export function createHealthRouter(mcpClient: McpClient): Router {
  const router = Router();
  const logger = getLogger();

  /**
   * GET /health - Bridge 및 MCP 프로세스 상태 확인
   */
  router.get("/", (req: Request, res: Response) => {
    const mcpState = mcpClient.getState();
    const mcpPid = mcpClient.getPid();
    const mcpCommand = mcpClient.getCommand();

    // 전체 상태 결정
    let overallStatus: "ok" | "degraded" | "error" = "ok";
    if (mcpState === McpProcessState.ERROR) {
      overallStatus = "error";
    } else if (mcpState !== McpProcessState.RUNNING) {
      overallStatus = "degraded";
    }

    // Power BI 연결 상태는 MCP가 실행 중이면 연결된 것으로 간주
    // 실제 연결 여부는 MCP 프로세스가 판단
    const powerbiConnected = mcpState === McpProcessState.RUNNING;

    const response: HealthResponse = {
      status: overallStatus,
      bridge: {
        version,
        uptime: Math.floor((Date.now() - bridgeStartTime) / 1000),
      },
      mcp: {
        state: mcpState,
        pid: mcpPid,
        command: mcpCommand,
      },
      powerbi: {
        connected: powerbiConnected,
      },
    };

    logger.debug("Health check", response);

    // 상태에 따라 HTTP 상태 코드 반환
    const statusCode = overallStatus === "ok" ? 200 : overallStatus === "degraded" ? 503 : 500;
    res.status(statusCode).json(response);
  });

  return router;
}
