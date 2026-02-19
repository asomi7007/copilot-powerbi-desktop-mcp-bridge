import { Request, Response, NextFunction } from "express";
import { getLogger } from "../logger";

/**
 * 전역 에러 핸들러 미들웨어
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const logger = getLogger();
  
  logger.error(`Unhandled error: ${error.message}`, {
    path: req.path,
    method: req.method,
    stack: error.stack,
  });

  // JSON-RPC 에러 형식으로 응답
  res.status(500).json({
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32603,
      message: "Internal server error",
      data: {
        details: error.message,
      },
    },
  });
}
