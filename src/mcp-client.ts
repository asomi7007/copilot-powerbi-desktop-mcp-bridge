import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import { JsonRpcRequest, JsonRpcResponse, McpProcessState } from "./types";
import { getLogger } from "./logger";

interface PendingRequest {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * MCP stdio 프로세스 관리 클라이언트
 */
export class McpClient {
  private process: ChildProcess | null = null;
  private state: McpProcessState = McpProcessState.STOPPED;
  private pendingRequests: Map<string | number, PendingRequest> = new Map();
  private startTime: number = 0;

  constructor(
    private command: string,
    private args: string[],
    private cwd: string | undefined,
    private startupTimeoutMs: number,
    private requestTimeoutMs: number
  ) {}

  /**
   * MCP 프로세스 시작
   */
  public async start(): Promise<void> {
    const logger = getLogger();

    if (this.state === McpProcessState.RUNNING) {
      logger.warn("MCP process is already running");
      return;
    }

    logger.info(`Starting MCP process: ${this.command} ${this.args.join(" ")}`);
    this.state = McpProcessState.STARTING;
    this.startTime = Date.now();

    return new Promise((resolve, reject) => {
      const startupTimeout = setTimeout(() => {
        this.state = McpProcessState.ERROR;
        reject(new Error(`MCP process startup timeout (${this.startupTimeoutMs}ms)`));
      }, this.startupTimeoutMs);

      try {
        this.process = spawn(this.command, this.args, {
          cwd: this.cwd || process.cwd(),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });

        if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
          clearTimeout(startupTimeout);
          this.state = McpProcessState.ERROR;
          reject(new Error("Failed to create MCP process stdio streams"));
          return;
        }

        // stdout을 줄 단위로 읽기
        const rl = readline.createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity,
        });

        rl.on("line", (line: string) => {
          this.handleStdoutLine(line);
        });

        // stderr 로깅
        this.process.stderr.on("data", (data: Buffer) => {
          logger.debug(`MCP stderr: ${data.toString()}`);
        });

        // 프로세스 종료 처리
        this.process.on("exit", (code: number | null, signal: string | null) => {
          logger.warn(`MCP process exited: code=${code}, signal=${signal}`);
          this.handleProcessExit();
        });

        this.process.on("error", (error: NodeJS.ErrnoException) => {
          this.state = McpProcessState.ERROR;
          
          // 친절한 에러 메시지 출력
          if (error.code === "ENOENT") {
            logger.error(`MCP 실행 파일을 찾을 수 없습니다: ${this.command}`);
            logger.error("해결 방법:");
            logger.error("  1. config.yaml에서 올바른 경로를 지정하세요");
            logger.error("  2. 환경변수 MCP_COMMAND를 설정하세요");
            logger.error("  3. exe 파일을 Bridge와 같은 폴더에 복사하세요");
          } else if (error.code === "EACCES" || error.code === "EPERM") {
            logger.error(`MCP 실행 파일에 대한 실행 권한이 없습니다: ${this.command}`);
            logger.error("해결 방법:");
            logger.error("  1. 파일 속성에서 '읽기 전용' 해제를 확인하세요");
            logger.error("  2. 관리자 권한으로 실행해보세요");
            logger.error("  3. 바이러스 백신 소프트웨어가 차단하는지 확인하세요");
          } else if (error.code === "ENOTDIR") {
            logger.error(`잘못된 경로입니다: ${this.command}`);
            logger.error("경로에 디렉토리가 아닌 파일이 포함되어 있습니다.");
          } else {
            logger.error(`MCP 프로세스 시작 실패: ${error.message}`);
            if (error.code) {
              logger.error(`에러 코드: ${error.code}`);
            }
          }
          
          this.handleProcessExit();
        });

        // 프로세스가 시작되면 성공으로 간주
        this.state = McpProcessState.RUNNING;
        clearTimeout(startupTimeout);
        
        // PID는 spawn 직후 undefined일 수 있으므로 확인
        const pid = this.process.pid;
        if (pid) {
          logger.info(`MCP process started with PID: ${pid}`);
        } else {
          logger.info(`MCP process started (PID pending...)`);
        }
        resolve();
      } catch (error) {
        clearTimeout(startupTimeout);
        this.state = McpProcessState.ERROR;
        logger.error(`Failed to start MCP process: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * MCP 프로세스 중지
   */
  public async stop(): Promise<void> {
    const logger = getLogger();

    if (!this.process || this.state === McpProcessState.STOPPED) {
      logger.warn("MCP process is not running");
      return;
    }

    logger.info("Stopping MCP process...");

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const killTimeout = setTimeout(() => {
        if (this.process && !this.process.killed) {
          logger.warn("Force killing MCP process");
          this.process.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      this.process.once("exit", () => {
        clearTimeout(killTimeout);
        this.state = McpProcessState.STOPPED;
        logger.info("MCP process stopped");
        resolve();
      });

      // Graceful shutdown 시도
      this.process.kill("SIGTERM");
    });
  }

  /**
   * JSON-RPC 요청 전송
   */
  public async sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const logger = getLogger();

    if (this.state !== McpProcessState.RUNNING || !this.process || !this.process.stdin) {
      throw new Error("MCP process is not running");
    }

    const requestJson = JSON.stringify(request);
    logger.debug(`Sending MCP request: ${request.method} (id: ${request.id})`);
    logger.debug(`MCP request payload: ${requestJson}`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        logger.warn(`MCP request timeout: ${request.method} (id: ${request.id})`);
        reject(new Error(`MCP request timeout (${this.requestTimeoutMs}ms)`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(request.id, {
        resolve: (response: JsonRpcResponse) => {
          if (response.error) {
            logger.error(
              `MCP response error for ${request.method} (id: ${request.id}): ` +
              `code=${response.error.code}, message=${response.error.message}` +
              (response.error.data ? `, data=${JSON.stringify(response.error.data)}` : "")
            );
          } else {
            logger.debug(`MCP response success for ${request.method} (id: ${request.id})`);
          }
          resolve(response);
        },
        reject,
        timeout,
      });

      try {
        this.process!.stdin!.write(requestJson + "\n", "utf8", (error) => {
          if (error) {
            clearTimeout(timeout);
            this.pendingRequests.delete(request.id);
            logger.error(`Failed to write to MCP stdin: ${error.message}`);
            reject(new Error(`Failed to write to MCP process: ${error.message}`));
          }
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(request.id);
        logger.error(`Failed to send MCP request: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * stdout 줄 처리
   */
  private handleStdoutLine(line: string): void {
    const logger = getLogger();

    if (!line.trim()) {
      return;
    }

    try {
      const response = JSON.parse(line) as JsonRpcResponse;
      logger.debug(`Received MCP response (id: ${response.id})`);

      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      } else {
        logger.warn(`Received MCP response for unknown request id: ${response.id}`);
      }
    } catch (error) {
      logger.error(`Failed to parse MCP stdout line: ${error}`);
      logger.debug(`Raw line: ${line}`);
    }
  }

  /**
   * 프로세스 종료 처리
   */
  private handleProcessExit(): void {
    const logger = getLogger();
    this.state = McpProcessState.STOPPED;

    // 대기 중인 모든 요청을 에러로 reject
    const error = new Error("MCP process exited unexpectedly");
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      logger.warn(`Rejecting pending request (id: ${id}) due to process exit`);
    }
    this.pendingRequests.clear();
  }

  /**
   * 프로세스 상태 조회
   */
  public getState(): McpProcessState {
    return this.state;
  }

  /**
   * 프로세스 PID 조회
   */
  public getPid(): number | undefined {
    return this.process?.pid;
  }

  /**
   * 실행 명령어 조회
   */
  public getCommand(): string {
    return `${this.command} ${this.args.join(" ")}`;
  }

  /**
   * 업타임 조회 (초)
   */
  public getUptime(): number {
    if (this.state !== McpProcessState.RUNNING) {
      return 0;
    }
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}
