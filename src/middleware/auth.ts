import { Request, Response, NextFunction } from "express";
import { getLogger } from "../logger";

/**
 * API Key 인증 미들웨어
 */
export function createAuthMiddleware(apiKey?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // API Key가 설정되지 않았으면 인증 생략
    if (!apiKey) {
      next();
      return;
    }

    const requestApiKey = req.headers["x-api-key"];
    
    if (!requestApiKey) {
      getLogger().warn(`Unauthorized request from ${req.ip}: Missing API key`);
      res.status(401).json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Missing X-API-Key header",
        },
      });
      return;
    }

    if (requestApiKey !== apiKey) {
      getLogger().warn(`Unauthorized request from ${req.ip}: Invalid API key`);
      res.status(401).json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Invalid API key",
        },
      });
      return;
    }

    next();
  };
}
