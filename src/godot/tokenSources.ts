// OOB token sources (spec 2.1 step 2; design section 0 Q1).
// Order: env GODOT_MCP_TOKEN (canonical) -> status file
// <project>/.godot/mcp-token.json -> editor-log scrape (fallback, warns).
// Re-read on AUTH_FAILED by calling resolveToken() again (fresh read,
// no caching); the caller retries auth exactly once, then surfaces.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EnvelopeError } from "./mcpErrors.js";

export const CANONICAL_TOKEN_ENV = "GODOT_MCP_TOKEN";
export const TOKEN_STATUS_DIR = ".godot";
export const TOKEN_STATUS_FILE = "mcp-token.json";

export type TokenSource = "env" | "status-file" | "editor-log";

export interface TokenResolution {
  token: string;
  source: TokenSource;
}

export interface TokenLog {
  warn: (message: string) => void;
  info?: (message: string) => void;
  debug?: (message: string) => void;
}

export interface TokenSourceOptions {
  projectRoot?: string;
  log?: TokenLog;
  env?: NodeJS.ProcessEnv;
  readStatusFile?: (path: string) => Promise<string>;
  readEditorLog?: () => Promise<string | null>;
}

function dbg(log: TokenLog | undefined, message: string): void {
  log?.debug?.(`godot-mcp-server: ${message}`);
}

// Matches the editor start_server token line (websocket_server.gd);
// falls back to any long hex run so future log formats still resolve.
export function scrapeTokenFromLogText(text: string): string | null {
  const tagged = /start_server[^\n]*?token[^\n]*?([0-9a-fA-F]{8,})/.exec(text);
  if (tagged?.[1] !== undefined) return tagged[1];
  const bare = /\b([0-9a-fA-F]{32,})\b/.exec(text);
  return bare?.[1] ?? null;
}

async function fromStatusFile(
  projectRoot: string,
  read: (path: string) => Promise<string>,
): Promise<string | null> {
  const path = join(projectRoot, TOKEN_STATUS_DIR, TOKEN_STATUS_FILE);
  let raw: string;
  try {
    raw = await read(path);
  } catch {
    return null; // absent file: next source, not an error.
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { token?: unknown }).token === "string" &&
      (parsed as { token: string }).token.length > 0
    ) {
      return (parsed as { token: string }).token;
    }
    return null;
  } catch {
    return null; // corrupt file: next source, not an error.
  }
}

export async function resolveToken(opts?: TokenSourceOptions): Promise<TokenResolution> {
  const log = opts?.log;
  const env = opts?.env ?? process.env;
  const fromEnv = env[CANONICAL_TOKEN_ENV];
  dbg(log, "token lookup: trying env " + CANONICAL_TOKEN_ENV);
  if (fromEnv !== undefined && fromEnv.length > 0) {
    log?.info?.("godot-mcp-server: token source=env");
    return { token: fromEnv, source: "env" };
  }
  const projectRoot = opts?.projectRoot ?? process.cwd();
  const read = opts?.readStatusFile ?? ((path: string) => readFile(path, "utf8"));
  dbg(log, "token lookup: trying status file");
  const filed = await fromStatusFile(projectRoot, read);
  if (filed !== null) {
    log?.info?.("godot-mcp-server: token source=status-file");
    return { token: filed, source: "status-file" };
  }
  dbg(log, "token lookup: trying editor-log scrape");
  const text = await opts?.readEditorLog?.() ?? null;
  const scraped = text !== null ? scrapeTokenFromLogText(text) : null;
  if (scraped !== null) {
    log?.warn(
      `godot-mcp-server: token scraped from editor log (fallback); set ${CANONICAL_TOKEN_ENV} instead`,
    );
    return { token: scraped, source: "editor-log" };
  }
  throw new EnvelopeError(
    "AUTH_FAILED",
    `AUTH_FAILED: no token found (set ${CANONICAL_TOKEN_ENV}, or provide <project>/.godot/${TOKEN_STATUS_FILE})`,
    { retryable: false },
  );
}
