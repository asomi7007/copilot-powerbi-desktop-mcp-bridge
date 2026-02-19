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

        this.process.on("error", (error: Error) => {
          logger.error(`MCP process error: ${error.message}`);
          this.state = McpProcessState.ERROR;
          this.handleProcessExit();
        });

        // 프로세스가 시작되면 성공으로 간주
        this.state = McpProcessState.RUNNING;
        clearTimeout(startupTimeout);
        logger.info(`MCP process started with PID: ${this.process.pid}`);
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

    logger.debug(`Sending MCP request: ${request.method} (id: ${request.id})`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        logger.warn(`MCP request timeout: ${request.method} (id: ${request.id})`);
        reject(new Error(`MCP request timeout (${this.requestTimeoutMs}ms)`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(request.id, {
        resolve,
        reject,
        timeout,
      });

      try {
        const requestJson = JSON.stringify(request) + "\n";
        this.process!.stdin!.write(requestJson, "utf8", (error) => {
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
