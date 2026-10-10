#!/usr/bin/env node
// bin godot-mcp-server: flag parse plus flags/config/env merge only.
// Tool wiring lives in buildServer; transports own their listeners.

import { realpathSync } from "node:fs";
import { loadConfig } from "./server/config.js";
import { buildServer } from "./server/buildServer.js";
import { serveStdio } from "./transports/stdio.js";
import { serveHttp, DEFAULT_HTTP_PORT } from "./transports/http.js";

export interface CliFlags {
  http: boolean;
  port: number | null;
  noAuth: boolean;
  help: boolean;
}

export const USAGE = `godot-mcp-server: bridge MCP clients and the running Godot editor

usage: godot-mcp-server [--http [--port <n>]] [--no-auth] [--help]

  --http       serve Streamable HTTP on 127.0.0.1 (default: stdio)
  --port <n>   http listen port (default ${DEFAULT_HTTP_PORT})
  --no-auth    negotiate against vanilla addons (handshake lands in Task 4)
  --help       print this text and exit 0
`;

export function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { http: false, port: null, noAuth: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--http") flags.http = true;
    else if (arg === "--no-auth") flags.noAuth = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--port" || arg.startsWith("--port=")) {
      const raw = arg.includes("=") ? arg.slice("--port=".length) : (argv[i + 1] ?? "");
      if (!arg.includes("=")) i += 1;
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed)) throw new Error(`invalid --port value: "${raw}"`);
      flags.port = parsed;
    } else throw new Error(`unknown flag: "${arg}" (see --help)`);
  }
  return flags;
}

// Merge order: --port flag > GODOT_MCP_HTTP_PORT env > default 3000.
// The bridge port (config.port, default 6550) is unrelated and untouched.
export function resolveHttpPort(flags: CliFlags, env: NodeJS.ProcessEnv = process.env): number {
  if (flags.port !== null) return flags.port;
  const raw = env["GODOT_MCP_HTTP_PORT"] ?? "";
  if (raw.length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return DEFAULT_HTTP_PORT;
}

export interface MainDeps {
  stdout?: (text: string) => void;
  exit?: (code: number) => never;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: MainDeps = {},
): Promise<void> {
  const out = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const exit = deps.exit ?? ((code: number): never => process.exit(code));
  const flags = parseArgs(argv);
  if (flags.help) {
    out(USAGE);
    exit(0);
  }
  loadConfig(); // validates env overlay today; bridge wiring lands in Task 3+
  if (flags.http) await serveHttp({ port: resolveHttpPort(flags) });
  else await serveStdio();
}

// Resolved through realpath so npm .bin symlinks (argv[1] names the
// link, not cli.js) still count as bin invocations. Importers (tests,
// programmatic use) resolve to any other entry file and skip main().
function isInvokedAsBin(): boolean {
  try {
    const entry = process.argv[1] ?? "";
    return entry.length > 0 && realpathSync(entry).endsWith("cli.js");
  } catch {
    return false;
  }
}

if (isInvokedAsBin()) void main();
