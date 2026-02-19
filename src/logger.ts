import * as winston from "winston";
import * as path from "path";
import * as fs from "fs";

let logger: winston.Logger | null = null;

/**
 * Winston 로거 초기화
 */
export function initLogger(level: string, logFile?: string): winston.Logger {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let metaStr = "";
          if (Object.keys(meta).length > 0) {
            metaStr = " " + JSON.stringify(meta);
          }
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      ),
    }),
  ];

  // 파일 로깅 활성화 시
  if (logFile) {
    // 로그 디렉토리 생성
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    transports.push(
      new winston.transports.File({
        filename: logFile,
        format: winston.format.combine(
          winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            let metaStr = "";
            if (Object.keys(meta).length > 0) {
              metaStr = " " + JSON.stringify(meta);
            }
            return `${timestamp} [${level}] ${message}${metaStr}`;
          })
        ),
      })
    );
  }

  logger = winston.createLogger({
    level: level.toLowerCase(),
    transports,
  });

  return logger;
}

/**
 * 로거 인스턴스 가져오기
 */
export function getLogger(): winston.Logger {
  if (!logger) {
    // 로거가 초기화되지 않았으면 기본 로거 반환
    return winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()],
    });
  }
  return logger;
}
