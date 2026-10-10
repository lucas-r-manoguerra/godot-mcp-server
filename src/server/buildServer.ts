// buildServer factory (design section 1): composition only. Constructs
// the McpServer, seeds the registry, attaches server_status, and returns
// { server, ctx }. Zero transport logic; stdio and http share this.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";
import { relayTimeoutFor } from "../godot/budgets.js";
import { validate_scoped_path } from "../godot/scopedPath.js";
import { ToolRegistry, type ToolDef } from "./toolRegistry.js";
import { toolDefs as assetDefs } from "../tools/assets.js";
import { toolDefs as introspectionDefs } from "../tools/introspection.js";
import { toolDefs as nodeDefs } from "../tools/nodes.js";
import { toolDefs as signalDefs } from "../tools/signals.js";
import { toolDefs as verifyDefs } from "../tools/verify.js";
import { toolDefs as viewportDefs } from "../tools/viewport.js";
import { toolDefs as animationDefs } from "../tools/passthrough/animation.js";
import { toolDefs as debugDefs } from "../tools/passthrough/debug.js";
import { toolDefs as execDefs } from "../tools/passthrough/exec.js";
import { toolDefs as gameTimeDefs } from "../tools/passthrough/gameTime.js";
import { toolDefs as inputDefs } from "../tools/passthrough/input.js";
import { toolDefs as meshesDefs } from "../tools/passthrough/meshes.js";
import { toolDefs as nodeEditDefs } from "../tools/passthrough/nodeEdit.js";
import { toolDefs as profilerDefs } from "../tools/passthrough/profiler.js";
import { toolDefs as projectDefs } from "../tools/passthrough/project.js";
import { toolDefs as resources3dDefs } from "../tools/passthrough/resources3d.js";
import { toolDefs as runtimeDefs } from "../tools/passthrough/runtime.js";
import { toolDefs as sceneDefs } from "../tools/passthrough/scene.js";
import { toolDefs as screenshotsDefs } from "../tools/passthrough/screenshots.js";
import { toolDefs as selectionDefs } from "../tools/passthrough/selection.js";
import { toolDefs as tilesDefs } from "../tools/passthrough/tiles.js";
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
  // Every ToolDef module (gap + passthrough + verify) wires through
  // this single loop: registry for resolve/unknownCommand, McpServer
  // for the tools/list + tools/call surface. Handlers keep their
  // (args, ctx) contract; the adapter only wraps the result in the
  // SDK CallToolResult envelope. No schema/behavior changes here.
  const moduleDefs: ToolDef[] = [
    ...introspectionDefs,
    ...nodeDefs,
    ...signalDefs,
    ...viewportDefs,
    ...assetDefs,
    ...verifyDefs,
    ...sceneDefs,
    ...nodeEditDefs,
    ...selectionDefs,
    ...projectDefs,
    ...debugDefs,
    ...runtimeDefs,
    ...inputDefs,
    ...screenshotsDefs,
    ...resources3dDefs,
    ...meshesDefs,
    ...profilerDefs,
    ...gameTimeDefs,
    ...execDefs,
    ...animationDefs,
    ...tilesDefs,
  ];
  for (const def of moduleDefs) {
    registry.register_tool(def);
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      async (args: Record<string, unknown>) => ({
        content: [{ type: "text" as const, text: JSON.stringify(await def.handler(args, ctx)) }],
      }),
    );
  }
  return { server, ctx, registry };
}
