// buildServer factory (design section 1): composition only. Constructs
// the McpServer, seeds the registry, owns the lazy WS client +
// negotiation wiring behind ctx.send, attaches server_status, and
// returns { server, ctx, registry, client }. Zero transport logic;
// stdio and http share this.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";
import { relayTimeoutFor } from "../godot/budgets.js";
import {
  connectWsSocket,
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
} from "../godot/connectSocket.js";
import { EnvelopeError } from "../godot/envelope.js";
import {
  createNegotiationWiring,
  toServerStatusRecord,
  type NegotiationResult,
} from "../godot/handshake.js";
import { WsClient, type WsSocket } from "../godot/wsClient.js";
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
  client: WsClient;
}

export interface BuildServerLog {
  warn: (message: string) => void;
  info: (message: string) => void;
  debug?: (message: string) => void;
}

// Server logs must never touch stdout: the stdio transport speaks
// JSON-RPC there, so even a negotiation line would corrupt framing.
// Default log targets stderr (safe for stdio and HTTP alike).
export function stderrLog(): BuildServerLog {
  return {
    warn: (message: string): void => console.error(message),
    info: (message: string): void => console.error(message),
    debug: (message: string): void => console.error(message),
  };
}

export interface BuildServerOptions {
  projectRoot?: string;
  projectName?: string;
  mode?: string;
  // Bridge WS endpoint (defaults 127.0.0.1:6550 from connectSocket.ts).
  bridgeHost?: string;
  bridgePort?: number;
  // Vanilla-addon probe path (default: auth-first negotiation).
  noAuth?: boolean;
  // Godot project dir: status-file + log-scrape root for the token
  // sources. Defaults to projectRoot ?? cwd so the live split (server
  // cwd X, Godot project in sibling Y) resolves via --project-dir /
  // GODOT_PROJECT_DIR / godot-mcp.projectDir.
  projectDir?: string;
  // Transport injection for editor-free tests. Default opens the real
  // editor socket via connectWsSocket.
  connectSocket?: () => Promise<WsSocket>;
  env?: NodeJS.ProcessEnv;
  log?: BuildServerLog;
}

// Client-side timeout overrides ride in params but never cross the
// wire (envelope.ts strips them); forward them as the call budget so
// the ws-roundtrip hop respects them.
function timeoutOverride(
  params: Record<string, unknown>,
): { timeout_ms: number } | undefined {
  const raw = params["timeout_ms"] ?? params["timeoutMs"];
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return { timeout_ms: raw };
  }
  return undefined;
}

export function buildServer(opts: BuildServerOptions = {}): BuiltServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const registry = new ToolRegistry();
  const capabilities = defaultStatusRecord();
  if (opts.mode !== undefined) capabilities.mode = opts.mode;
  if (opts.projectRoot !== undefined) capabilities.project_path = opts.projectRoot;
  if (opts.projectName !== undefined) capabilities.project_name = opts.projectName;
  const projectDir = opts.projectDir ?? opts.projectRoot ?? process.cwd();
  const bridgeHost = opts.bridgeHost ?? DEFAULT_BRIDGE_HOST;
  const bridgePort = opts.bridgePort ?? DEFAULT_BRIDGE_PORT;
  const env = opts.env ?? process.env;
  const log: BuildServerLog = opts.log ?? stderrLog();
  // The WsClient owns the transport (FIFO, budgets, reconnect); the
  // T4 negotiation wiring owns the auth-first frames over it. Token
  // source order stays canonical: env -> status file -> log scrape.
  const wiring = createNegotiationWiring({
    noAuth: opts.noAuth,
    tokenOptions: { projectRoot: projectDir, env, log },
    log,
  });
  const client = new WsClient({
    connectSocket:
      opts.connectSocket ?? (() => connectWsSocket({ host: bridgeHost, port: bridgePort })),
    authenticate: wiring.authenticate,
    handshake: wiring.handshake,
    log,
  });
  const ctx: ServerContext = {
    send: (command, params) => liveSend(command, params),
    capabilities,
    mode: capabilities.mode,
    budgets: { relayTimeoutFor },
    scopedGuard: validate_scoped_path,
  };
  // Lazy connect on the first tool call, race-safe: concurrent first
  // calls share one connection in flight. A failed attempt clears the
  // flight so the next call retries instead of caching the failure.
  let connectFlight: Promise<NegotiationResult> | null = null;
  function ensureConnected(): Promise<NegotiationResult> {
    const ready = wiring.getResult();
    if (client.getState() === "READY" && ready !== null) return Promise.resolve(ready);
    if (connectFlight !== null) return connectFlight;
    connectFlight = client
      .connect()
      .then(() => {
        const result = wiring.getResult();
        if (result === null) {
          throw new Error(
            "not connected: handshake completed without a capability record",
          );
        }
        const status = toServerStatusRecord(result);
        capabilities.mode = status.mode;
        capabilities.addon_version = status.addon_version;
        capabilities.godot_version = status.godot_version;
        capabilities.project_path = status.project_path;
        capabilities.project_name = status.project_name;
        capabilities.protocol_drift_suspected = status.protocol_drift_suspected;
        ctx.mode = capabilities.mode;
        return result;
      })
      .catch((err: unknown) => {
        connectFlight = null;
        throw err;
      });
    return connectFlight;
  }
  async function liveSend(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await ensureConnected();
    const frame = await client.call(command, params, timeoutOverride(params));
    if (frame.status === "success") return frame.result;
    throw new EnvelopeError(
      frame.error.code,
      `${frame.error.code}: ${frame.error.message}`,
      {
        retryable: frame.error.code === "ALREADY_CONNECTED",
        hint:
          frame.error.code === "ALREADY_CONNECTED"
            ? "retry with backoff / queue / hand off single editor session"
            : undefined,
        command,
      },
    );
  }
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
  return { server, ctx, registry, client };
}
