// Auth-first handshake + --no-auth probe negotiation (spec 2;
// design sections 0 Q1-Q2, 2). Default path: auth -> mcp_handshake with
// server_version "godot-mcp-server/<semver>". --no-auth probes
// mcp_handshake -> heartbeat; AUTH_REQUIRED anywhere switches UP to the
// auth path with a log (never a silent downgrade). A default start
// against a peer that does not know auth negotiates no-auth VISIBLY
// (spec 2.3b). Every negotiation emits the normative mode line.

import { SERVER_NAME, SERVER_VERSION } from "../version.js";
import {
  checkProtocolDrift,
  degradedLegacyRecord,
  validateCapabilities,
  type CapabilityRecord,
} from "./capabilities.js";
import {
  buildOutboundFrame,
  parseInboundFrame,
  uuidv7,
  EnvelopeError,
  type InboundFrame,
} from "./envelope.js";
import { resolveToken, type TokenSourceOptions } from "./tokenSources.js";
import type { WsSocket } from "./wsClient.js";

export type NegotiatedMode = "auth" | "no-auth-full" | "no-auth-legacy";

export interface NegotiationResult {
  mode: NegotiatedMode;
  capabilities: CapabilityRecord;
  protocol_drift_suspected: boolean;
}

export interface HandshakeLog {
  warn: (message: string) => void;
  info: (message: string) => void;
}

export type SendRpc = (command: string, params: Record<string, unknown>) => Promise<InboundFrame>;

export interface NegotiateOptions {
  noAuth?: boolean;
  resolveToken?: () => Promise<string>;
  serverVersion?: string;
  log?: HandshakeLog;
}

export function defaultServerVersion(): string {
  return `${SERVER_NAME}/${SERVER_VERSION}`;
}

// Normative format (spec 2.2 step 3): asserted byte-equal by tests.
export function formatNegotiationLine(mode: NegotiatedMode, caps: CapabilityRecord): string {
  return `godot-mcp-server: negotiated mode=${mode} addon=${caps.addon_version} godot=${caps.godot_version}`;
}

function finish(
  mode: NegotiatedMode,
  capabilities: CapabilityRecord,
  log: HandshakeLog,
): NegotiationResult {
  const protocol_drift_suspected = checkProtocolDrift(capabilities, log);
  log.info(formatNegotiationLine(mode, capabilities));
  return { mode, capabilities, protocol_drift_suspected };
}

function asError(frame: InboundFrame): { code: string; message: string } | null {
  return frame.status === "error" ? frame.error : null;
}

function surface(command: string, err: { code: string; message: string }): never {
  throw new EnvelopeError(err.code, `${err.code}: ${err.message}`, { retryable: false, command });
}

// Single auth exchange with AUTH_FAILED retry-once (spec 2.1 step 3).
async function sendAuth(send: SendRpc, readToken: () => Promise<string>): Promise<void> {
  let reply = await send("auth", { token: await readToken() });
  const first = asError(reply);
  if (first?.code === "AUTH_FAILED") {
    reply = await send("auth", { token: await readToken() });
    const second = asError(reply);
    if (second !== null) surface("auth", second);
  } else if (first !== null) {
    surface("auth", first);
  }
}

// Auth-first path (spec 2.1 steps 2-5). Reconnect between the
// AUTH_FAILED attempts is the caller's job.
async function authPath(
  send: SendRpc,
  readToken: () => Promise<string>,
  serverVersion: string,
  log: HandshakeLog,
): Promise<NegotiationResult> {
  await sendAuth(send, readToken);
  const reply = await send("mcp_handshake", { server_version: serverVersion });
  const hs = asError(reply);
  if (hs !== null) surface("mcp_handshake", hs);
  if (reply.status !== "success") surface("mcp_handshake", { code: "INVALID_FORMAT", message: "missing result" });
  return finish("auth", validateCapabilities(reply.result), log);
}

// Probe path (spec 2.2 step 1). Throws AuthRequiredSwitch when a probe
// hits AUTH_REQUIRED so the caller can switch up to authPath.
class AuthRequiredSwitch extends Error {}
async function probePath(
  send: SendRpc,
  serverVersion: string,
  log: HandshakeLog,
): Promise<NegotiationResult> {
  const hs = await send("mcp_handshake", { server_version: serverVersion });
  const hsErr = asError(hs);
  if (hsErr?.code === "AUTH_REQUIRED") throw new AuthRequiredSwitch();
  if (hsErr === null && hs.status === "success") {
    return finish("no-auth-full", validateCapabilities(hs.result), log);
  }
  const hb = await send("heartbeat", {});
  const hbErr = asError(hb);
  if (hbErr?.code === "AUTH_REQUIRED") throw new AuthRequiredSwitch();
  if (hbErr !== null) surface("heartbeat", hbErr);
  if (hb.status !== "success") surface("heartbeat", { code: "INVALID_FORMAT", message: "missing result" });
  const echo =
    typeof hb.result === "object" && hb.result !== null
      ? (hb.result as Record<string, unknown>)["server_version"]
      : undefined;
  const caps = degradedLegacyRecord(echo);
  return finish("no-auth-legacy", caps, log);
}

export async function negotiate(send: SendRpc, opts?: NegotiateOptions): Promise<NegotiationResult> {
  const log = opts?.log ?? console;
  const serverVersion = opts?.serverVersion ?? defaultServerVersion();
  const readToken = opts?.resolveToken ?? (async () => (await resolveToken({ log })).token);
  if (opts?.noAuth !== true) {
    try {
      return await authPath(send, readToken, serverVersion, log);
    } catch (err) {
      // Peer does not know auth (vanilla): visible negotiation down,
      // never silent (spec 2.3b). AUTH_FAILED still surfaces via authPath.
      if (err instanceof EnvelopeError && err.message.startsWith("UNKNOWN_COMMAND")) {
        log.warn("godot-mcp-server: peer does not recognize auth; negotiating no-auth visibly");
        return await probePath(send, serverVersion, log);
      }
      throw err;
    }
  }
  try {
    return await probePath(send, serverVersion, log);
  } catch (err) {
    if (err instanceof AuthRequiredSwitch) {
      log.warn("godot-mcp-server: probe hit AUTH_REQUIRED; switching up to auth (no downgrade)");
      return await authPath(send, readToken, serverVersion, log);
    }
    throw err;
  }
}

// Status-tool record for a negotiation (feeds registerServerStatusTool;
// the assertion surface for mode alongside the log line, spec 2.2).
export function toServerStatusRecord(result: NegotiationResult): {
  mode: string;
  addon_version: string;
  godot_version: string;
  project_path: string;
  project_name: string;
  server_version: string;
  protocol_drift_suspected: boolean;
} {
  return {
    mode: result.mode,
    addon_version: result.capabilities.addon_version,
    godot_version: result.capabilities.godot_version,
    project_path: result.capabilities.project_path,
    project_name: result.capabilities.project_name,
    server_version: defaultServerVersion(),
    protocol_drift_suspected: result.protocol_drift_suspected,
  };
}

// -- WsClient wiring (uses the T3 authenticate/handshake hooks) --

export interface SocketNegotiationOptions {
  noAuth?: boolean;
  tokenOptions?: TokenSourceOptions;
  serverVersion?: string;
  log?: HandshakeLog;
  requestTimeoutMs?: number;
}

export interface NegotiationWiring {
  authenticate: (socket: WsSocket) => Promise<void>;
  handshake: (socket: WsSocket) => Promise<void>;
  getResult: () => NegotiationResult | null;
}

// Request/response over one socket frame. Chains the installed
// onMessage so foreign frames still reach the WsClient handler.
export function requestOverSocket(
  socket: WsSocket,
  command: string,
  params: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<InboundFrame> {
  const frame = buildOutboundFrame(command, params, { id: uuidv7() });
  const id = frame.id;
  return new Promise<InboundFrame>((resolve, reject) => {
    const prev = socket.onMessage;
    const timer = setTimeout(() => {
      socket.onMessage = prev;
      reject(new EnvelopeError("RELAY_TIMEOUT", `RELAY_TIMEOUT: "${command}" exceeded ws-roundtrip budget`, {
        retryable: true, command,
      }));
    }, timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    socket.onMessage = (text: string) => {
      let parsed: InboundFrame;
      try {
        parsed = parseInboundFrame(text);
      } catch {
        prev?.(text);
        return;
      }
      if (parsed.id !== id) {
        prev?.(text);
        return;
      }
      clearTimeout(timer);
      socket.onMessage = prev;
      resolve(parsed);
    };
    socket.send(JSON.stringify(frame));
  });
}

export function createNegotiationWiring(opts?: SocketNegotiationOptions): NegotiationWiring {
  const log = opts?.log ?? console;
  const noAuth = opts?.noAuth === true;
  const serverVersion = opts?.serverVersion ?? defaultServerVersion();
  const timeoutMs = opts?.requestTimeoutMs ?? 15_000;
  let authedToken: string | null = null;
  let result: NegotiationResult | null = null;
  const sendFor =
    (socket: WsSocket): SendRpc =>
    (command, params) =>
      requestOverSocket(socket, command, params, timeoutMs);
  return {
    authenticate: async (socket: WsSocket): Promise<void> => {
      if (noAuth) return; // probes (with switch-up) run in handshake.
      const send = sendFor(socket);
      const readToken = async (): Promise<string> => {
        const r = await resolveToken({ ...opts?.tokenOptions, log });
        authedToken = r.token;
        return r.token;
      };
      await sendAuth(send, readToken); // auth phase proves the token only.
    },
    handshake: async (socket: WsSocket): Promise<void> => {
      const send = sendFor(socket);
      if (authedToken !== null && !noAuth) {
        const reply = await send("mcp_handshake", { server_version: serverVersion });
        const err = asError(reply);
        if (err !== null) surface("mcp_handshake", err);
        if (reply.status !== "success") surface("mcp_handshake", { code: "INVALID_FORMAT", message: "missing result" });
        result = finish("auth", validateCapabilities(reply.result), log);
        return;
      }
      result = await negotiate(send, {
        noAuth, serverVersion, log,
        resolveToken: async () => (await resolveToken({ ...opts?.tokenOptions, log })).token,
      });
    },
    getResult: () => result,
  };
}
