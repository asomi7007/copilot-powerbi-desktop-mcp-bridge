import * as fs from "fs";
import * as path from "path";
import { McpToolResult, McpToolSchema } from "./types";
import { getLogger } from "./logger";

/**
 * Filesystem 도구를 Bridge 프로세스 안에 직접 내장하는 모듈.
 *
 * 별도의 stdio MCP 자식 프로세스를 띄우지 않으므로 사용자 PC에 Node.js를
 * 추가 설치할 필요가 없다. 도구 인터페이스는 @modelcontextprotocol/server-filesystem
 * 의 공식 spec과 동등하므로 Copilot Studio 입장에서는 동일한 도구로 보인다.
 *
 * 모든 파일 작업은 다음 보안 장치를 통과해야 한다:
 *  - 입력 경로의 NUL 바이트 거부
 *  - path.resolve 후 fs.realpath로 심볼릭 링크 해석 (= 심링크 탈출 방지)
 *  - 결과가 allowedPaths 중 하나의 경계 안에 있는지 정확히 검사 (sep 단위)
 *  - 읽기/쓰기 크기를 maxFileSizeBytes로 제한 (DoS 완화)
 *
 * 위 검증 중 하나라도 실패하면 즉시 에러 반환 — 파일 작업은 절대 수행되지 않는다.
 */

// ---------------------------------------------------------------------------
// 도구 이름 (멀티 MCP 라우터의 분기 키)
// ---------------------------------------------------------------------------
export const FILESYSTEM_TOOL_NAMES = [
  "read_file",
  "write_file",
  "edit_file",
  "create_directory",
  "list_directory",
  "move_file",
  "search_files",
  "get_file_info",
  "list_allowed_directories",
] as const;

export type FilesystemToolName = (typeof FILESYSTEM_TOOL_NAMES)[number];

const FS_NAME_SET: ReadonlySet<string> = new Set<string>(FILESYSTEM_TOOL_NAMES);

export function isFilesystemTool(name: string): boolean {
  return FS_NAME_SET.has(name);
}

// ---------------------------------------------------------------------------
// MCP tools/list 스키마 (공식 server-filesystem과 동일한 형태)
// ---------------------------------------------------------------------------
export const FILESYSTEM_TOOL_SCHEMAS: McpToolSchema[] = [
  {
    name: "read_file",
    description:
      "Read the complete contents of a file from the local filesystem. Returns text content (utf-8). Use for examining a single file. Only works within allowed directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Create a new file or completely overwrite an existing file with the provided content (utf-8). Use with caution as it overwrites without warning. Only works within allowed directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string", description: "Full file content in utf-8." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_file",
    description:
      "Apply line-based edits to a text file. Each edit replaces all occurrences of `oldText` with `newText`. If `oldText` is not found, the edit is reported as a failure but the file is not corrupted. Only works within allowed directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          description: "An ordered list of {oldText, newText} pairs.",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
          },
        },
        dryRun: { type: "boolean", description: "If true, return diff but do not write." },
      },
      required: ["path", "edits"],
      additionalProperties: false,
    },
  },
  {
    name: "create_directory",
    description:
      "Create a new directory or ensure a directory exists. Creates intermediate directories as needed (recursive). Only works within allowed directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_directory",
    description:
      "Get a listing of all files and subdirectories at the given path. Returns each entry prefixed with [FILE] or [DIR]. Only works within allowed directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "move_file",
    description:
      "Move or rename a file or directory. Both the source and the destination must be within allowed directories.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        destination: { type: "string" },
      },
      required: ["source", "destination"],
      additionalProperties: false,
    },
  },
  {
    name: "search_files",
    description:
      "Recursively search for files and directories whose name matches a substring (case-insensitive). Only works within allowed directories. Returns matching paths up to a configured limit.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Root directory to search." },
        pattern: { type: "string", description: "Substring to match against entry names." },
      },
      required: ["path", "pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "get_file_info",
    description:
      "Retrieve detailed metadata about a file or directory: size, mtime, ctime, mode, type. Only works within allowed directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_allowed_directories",
    description:
      "List the directories that this filesystem tool is permitted to access. No arguments. Use to discover where you can read/write before attempting file operations.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// 핸들러
// ---------------------------------------------------------------------------
export interface FilesystemHandlerOptions {
  allowedPaths: string[];
  maxFileSizeBytes: number;
  maxSearchResults: number;
}

export class FilesystemToolHandler {
  private readonly allowedReal: string[]; // 정규화된 절대경로 (case-normalized on win32)
  private readonly allowedDisplay: string[]; // 사용자 노출용 원본
  private readonly maxBytes: number;
  private readonly maxSearchResults: number;
  private readonly logger = getLogger();

  constructor(opts: FilesystemHandlerOptions) {
    this.maxBytes = opts.maxFileSizeBytes;
    this.maxSearchResults = opts.maxSearchResults;
    this.allowedDisplay = [];
    this.allowedReal = [];

    for (const p of opts.allowedPaths) {
      if (!p) continue;
      const abs = path.resolve(p);
      // 시작 시점에 폴더가 없을 수 있으므로 realpath는 가능할 때만
      let real = abs;
      try {
        real = fs.realpathSync(abs);
      } catch {
        // 폴더가 아직 없는 경우 절대경로로 폴백
      }
      this.allowedDisplay.push(abs);
      this.allowedReal.push(this.normCase(real));
    }

    if (this.allowedReal.length === 0) {
      this.logger.warn("Filesystem tools enabled but allowedPaths is empty — all calls will be rejected.");
    } else {
      this.logger.info(`Filesystem tools allowed paths: ${this.allowedDisplay.join(", ")}`);
    }
  }

  // 도구 호출 진입점. tool 이름과 args를 받아 MCP 표준 결과(McpToolResult)로 반환.
  async handle(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    try {
      switch (name as FilesystemToolName) {
        case "read_file":
          return await this.readFile(args);
        case "write_file":
          return await this.writeFile(args);
        case "edit_file":
          return await this.editFile(args);
        case "create_directory":
          return await this.createDirectory(args);
        case "list_directory":
          return await this.listDirectory(args);
        case "move_file":
          return await this.moveFile(args);
        case "search_files":
          return await this.searchFiles(args);
        case "get_file_info":
          return await this.getFileInfo(args);
        case "list_allowed_directories":
          return this.listAllowed();
        default:
          return errResult(`Unknown filesystem tool: ${name}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`filesystem tool '${name}' failed: ${msg}`);
      return errResult(msg);
    }
  }

  // -------------------------------------------------------------------------
  // 보안: 경로 정규화 + allowedPaths 경계 검증
  // -------------------------------------------------------------------------
  private normCase(p: string): string {
    return process.platform === "win32" ? p.toLowerCase() : p;
  }

  private isInsideAllowed(absReal: string): boolean {
    const target = this.normCase(absReal);
    for (const a of this.allowedReal) {
      if (target === a) return true;
      if (target.startsWith(a + path.sep)) return true;
    }
    return false;
  }

  // 기존 파일에 대한 안전한 절대경로 해석.
  // 심볼릭 링크 탈출 방지를 위해 realpath를 적용한 결과가 allowedPaths 안인지 확인.
  private async resolveExisting(rawPath: string): Promise<string> {
    const abs = this.requireAbsString(rawPath);
    const real = await fs.promises.realpath(abs);
    if (!this.isInsideAllowed(real)) {
      throw new Error(`Path is outside allowed directories: ${abs}`);
    }
    return real;
  }

  // 아직 존재하지 않을 수 있는 파일에 대한 안전한 절대경로 해석 (write/create 용).
  // 부모 디렉터리의 realpath를 기준으로 검사한다 — 부모도 없으면 검색을 위로 거슬러 올라간다.
  private async resolveForWrite(rawPath: string): Promise<string> {
    const abs = this.requireAbsString(rawPath);
    let cursor = abs;
    while (true) {
      try {
        const real = await fs.promises.realpath(cursor);
        const tail = abs.substring(cursor.length); // sep + ... or ''
        const candidate = real + tail;
        if (!this.isInsideAllowed(candidate)) {
          throw new Error(`Path is outside allowed directories: ${abs}`);
        }
        return candidate;
      } catch (e: any) {
        if (e && e.code === "ENOENT") {
          const parent = path.dirname(cursor);
          if (parent === cursor) {
            throw new Error(`Could not resolve any ancestor of: ${abs}`);
          }
          cursor = parent;
          continue;
        }
        throw e;
      }
    }
  }

  private requireAbsString(rawPath: unknown): string {
    if (typeof rawPath !== "string" || rawPath.length === 0) {
      throw new Error("path must be a non-empty string");
    }
    if (rawPath.indexOf("\0") !== -1) {
      throw new Error("path contains a NUL byte");
    }
    return path.resolve(rawPath);
  }

  // -------------------------------------------------------------------------
  // 도구 구현
  // -------------------------------------------------------------------------
  private async readFile(args: Record<string, unknown>): Promise<McpToolResult> {
    const real = await this.resolveExisting(String(args.path ?? ""));
    const stat = await fs.promises.stat(real);
    if (stat.isDirectory()) throw new Error("path is a directory; use list_directory instead");
    if (stat.size > this.maxBytes) {
      throw new Error(`file size ${stat.size} bytes exceeds limit ${this.maxBytes} bytes`);
    }
    const buf = await fs.promises.readFile(real, { encoding: "utf8" });
    return okText(buf);
  }

  private async writeFile(args: Record<string, unknown>): Promise<McpToolResult> {
    const content = String(args.content ?? "");
    if (Buffer.byteLength(content, "utf8") > this.maxBytes) {
      throw new Error(`content size exceeds limit ${this.maxBytes} bytes`);
    }
    const real = await this.resolveForWrite(String(args.path ?? ""));
    await fs.promises.mkdir(path.dirname(real), { recursive: true });
    await fs.promises.writeFile(real, content, { encoding: "utf8" });
    return okText(`Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${real}`);
  }

  private async editFile(args: Record<string, unknown>): Promise<McpToolResult> {
    const real = await this.resolveExisting(String(args.path ?? ""));
    const stat = await fs.promises.stat(real);
    if (stat.size > this.maxBytes) {
      throw new Error(`file size exceeds limit ${this.maxBytes} bytes`);
    }
    const edits = args.edits;
    if (!Array.isArray(edits)) throw new Error("edits must be an array");

    let text = await fs.promises.readFile(real, { encoding: "utf8" });
    const log: string[] = [];
    for (let i = 0; i < edits.length; i++) {
      const e = edits[i] as { oldText?: unknown; newText?: unknown };
      const oldText = String(e?.oldText ?? "");
      const newText = String(e?.newText ?? "");
      if (oldText.length === 0) {
        log.push(`#${i}: skip (empty oldText)`);
        continue;
      }
      const idx = text.indexOf(oldText);
      if (idx === -1) {
        log.push(`#${i}: NOT FOUND (oldText length=${oldText.length})`);
        continue;
      }
      text = text.split(oldText).join(newText);
      log.push(`#${i}: replaced ${oldText.length}→${newText.length} chars`);
    }
    const dryRun = args.dryRun === true;
    if (!dryRun) {
      await fs.promises.writeFile(real, text, { encoding: "utf8" });
    }
    return okText(`${dryRun ? "[dryRun] " : ""}edits applied:\n${log.join("\n")}`);
  }

  private async createDirectory(args: Record<string, unknown>): Promise<McpToolResult> {
    const real = await this.resolveForWrite(String(args.path ?? ""));
    await fs.promises.mkdir(real, { recursive: true });
    return okText(`Created directory: ${real}`);
  }

  private async listDirectory(args: Record<string, unknown>): Promise<McpToolResult> {
    const real = await this.resolveExisting(String(args.path ?? ""));
    const stat = await fs.promises.stat(real);
    if (!stat.isDirectory()) throw new Error("path is not a directory");
    const entries = await fs.promises.readdir(real, { withFileTypes: true });
    const lines: string[] = [];
    for (const e of entries) {
      const tag = e.isDirectory() ? "[DIR] " : e.isFile() ? "[FILE]" : "[OTHR]";
      lines.push(`${tag} ${e.name}`);
    }
    return okText(lines.length === 0 ? "(empty directory)" : lines.join("\n"));
  }

  private async moveFile(args: Record<string, unknown>): Promise<McpToolResult> {
    const srcReal = await this.resolveExisting(String(args.source ?? ""));
    const dstReal = await this.resolveForWrite(String(args.destination ?? ""));
    await fs.promises.mkdir(path.dirname(dstReal), { recursive: true });
    await fs.promises.rename(srcReal, dstReal);
    return okText(`Moved: ${srcReal} -> ${dstReal}`);
  }

  private async searchFiles(args: Record<string, unknown>): Promise<McpToolResult> {
    const root = await this.resolveExisting(String(args.path ?? ""));
    const pattern = String(args.pattern ?? "").toLowerCase();
    if (pattern.length === 0) throw new Error("pattern must be a non-empty string");

    const stat = await fs.promises.stat(root);
    if (!stat.isDirectory()) throw new Error("path is not a directory");

    const matches: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0 && matches.length < this.maxSearchResults) {
      const dir = stack.pop() as string;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // 권한 없는 디렉터리는 스킵
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        // 추가 보안: 검색 도중 발견된 모든 항목도 allowed 안인지 검사
        // (심링크가 가리키는 외부 폴더로 빠지지 않도록)
        let realFull = full;
        try {
          realFull = await fs.promises.realpath(full);
        } catch {
          continue;
        }
        if (!this.isInsideAllowed(realFull)) continue;

        if (e.name.toLowerCase().includes(pattern)) {
          matches.push(realFull);
          if (matches.length >= this.maxSearchResults) break;
        }
        if (e.isDirectory()) stack.push(realFull);
      }
    }
    if (matches.length === 0) return okText(`(no matches for '${pattern}')`);
    const truncated = matches.length >= this.maxSearchResults ? `\n... (truncated at ${this.maxSearchResults})` : "";
    return okText(matches.join("\n") + truncated);
  }

  private async getFileInfo(args: Record<string, unknown>): Promise<McpToolResult> {
    const real = await this.resolveExisting(String(args.path ?? ""));
    const s = await fs.promises.stat(real);
    const info = {
      path: real,
      size: s.size,
      type: s.isDirectory() ? "directory" : s.isFile() ? "file" : s.isSymbolicLink() ? "symlink" : "other",
      created: s.birthtime.toISOString(),
      modified: s.mtime.toISOString(),
      accessed: s.atime.toISOString(),
      mode: "0o" + (s.mode & 0o777).toString(8),
    };
    return okText(JSON.stringify(info, null, 2));
  }

  private listAllowed(): McpToolResult {
    if (this.allowedDisplay.length === 0) return okText("(no allowed directories configured)");
    return okText(this.allowedDisplay.map((p, i) => `${i + 1}. ${p}`).join("\n"));
  }
}

// ---------------------------------------------------------------------------
// 결과 헬퍼
// ---------------------------------------------------------------------------
function okText(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: false };
}

function errResult(message: string): McpToolResult {
  return { content: [{ type: "text", text: `ERROR: ${message}` }], isError: true };
}
