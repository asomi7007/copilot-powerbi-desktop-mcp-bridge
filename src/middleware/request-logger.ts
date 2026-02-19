import { Request, Response, NextFunction } from "express";
import { getLogger } from "../logger";

/**
 * 요청 로깅 미들웨어
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const logger = getLogger();
  const startTime = Date.now();

  // 응답이 완료되면 로깅
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? "warn" : "info";
    
    logger.log(logLevel, `${req.method} ${req.path}`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  });

  next();
}
