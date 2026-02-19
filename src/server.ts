import express, { Express } from "express";
import cors from "cors";
import { BridgeConfig } from "./types";
import { McpClient } from "./mcp-client";
import { createAuthMiddleware } from "./middleware/auth";
import { requestLogger } from "./middleware/request-logger";
import { errorHandler } from "./middleware/error-handler";
import { createMcpRouter } from "./routes/mcp";
import { createHealthRouter } from "./routes/health";

/**
 * Express 서버 생성 및 설정
 */
export function createServer(config: BridgeConfig, mcpClient: McpClient): Express {
  const app = express();

  // CORS 설정
  app.use(cors({
    origin: config.security.corsOrigins,
    credentials: true,
  }));

  // Body parser
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 요청 로깅
  app.use(requestLogger);

  // API Key 인증
  app.use(createAuthMiddleware(config.security.apiKey));

  // 라우트 등록
  app.use("/mcp", createMcpRouter(mcpClient));
  app.use("/health", createHealthRouter(mcpClient));

  // 루트 경로 - 간단한 정보 제공
  app.get("/", (req, res) => {
    res.json({
      name: "Copilot + Power BI Desktop MCP Bridge",
      version: "1.0.0",
      endpoints: {
        mcp: "POST /mcp - Send JSON-RPC requests to MCP process",
        health: "GET /health - Check bridge and MCP process status",
      },
    });
  });

  // 404 핸들러
  app.use((req, res) => {
    res.status(404).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32601,
        message: "Method not found",
        data: { path: req.path },
      },
    });
  });

  // 전역 에러 핸들러
  app.use(errorHandler);

  return app;
}
