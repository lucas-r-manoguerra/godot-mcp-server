// buildServer factory (design section 1): composition only. Constructs
// the McpServer, seeds the registry, attaches server_status, and returns
// { server, ctx }. Zero transport logic; stdio and http share this.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";
import { relayTimeoutFor } from "../godot/budgets.js";
import { validate_scoped_path } from "../godot/scopedPath.js";
import { ToolRegistry, type ToolDef } from "./toolRegistry.js";
import {
  defaultStatusRecord,
  registerServerStatusTool,
  SERVER_STATUS_DESCRIPTION,
  SERVER_STATUS_TOOL,
  type ServerStatusRecord,
} from "./serverStatus.js";

// Handler context (spec 4): envelope sender, capability record,
// negotiated mode, budget enforcers, scoped-path guard.
export interface ServerContext {
  send: (command: string, params?: Record<string, unknown>) => Promise<unknown>;
  capabilities: ServerStatusRecord;
  mode: string;
  budgets: { relayTimeoutFor: typeof relayTimeoutFor };
  scopedGuard: (path: string) => boolean;
}

export interface BuiltServer {
  server: McpServer;
  ctx: ServerContext;
  registry: ToolRegistry;
}

export interface BuildServerOptions {
  projectRoot?: string;
  projectName?: string;
  mode?: string;
}

function notConnected(command: string): Promise<unknown> {
  return Promise.reject(
    new Error(`not connected: WS client (Task 3) owns transport; "${command}" sent before connect`),
  );
}

export function buildServer(opts: BuildServerOptions = {}): BuiltServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const registry = new ToolRegistry();
  const capabilities = defaultStatusRecord();
  if (opts.mode !== undefined) capabilities.mode = opts.mode;
  if (opts.projectRoot !== undefined) capabilities.project_path = opts.projectRoot;
  if (opts.projectName !== undefined) capabilities.project_name = opts.projectName;
  const ctx: ServerContext = {
    send: (command) => notConnected(command),
    capabilities,
    mode: capabilities.mode,
    budgets: { relayTimeoutFor },
    scopedGuard: validate_scoped_path,
  };
  const statusDef: ToolDef = {
    name: SERVER_STATUS_TOOL,
    description: SERVER_STATUS_DESCRIPTION,
    inputSchema: {},
    handler: () => Promise.resolve(ctx.capabilities),
    kind: "builtin",
  };
  registry.register_tool(statusDef);
  registerServerStatusTool(server, () => ctx.capabilities);
  return { server, ctx, registry };
}
