// Outbound {id,command,params} builder, inbound {status,result,error}
// parser, and the MCP error shape (specs section 1).
//
// Transport-agnostic: no socket I/O here. The WS client (later slice)
// owns correlation state; this module owns framing rules.

import { randomBytes } from "node:crypto";

// 16 MB WS buffer ceiling (spec 1.1). Outbound frames larger than this
// are rejected client-side before touching the socket.
export const WS_PAYLOAD_CAP_BYTES = 16 * 1024 * 1024;

// Keys that live in MCP tool arguments but MUST NOT cross the wire
// (spec 1.1: timeouts, caps; unknown keys are never forwarded).
export const SERVER_LOCAL_OPTION_KEYS: readonly string[] = [
  "timeout_ms",
  "timeoutMs",
  "budget_ms",
  "budgetMs",
  "budget_class",
  "budgetClass",
  "max_width",
  "maxWidth",
  "result_cap_bytes",
  "resultCapBytes",
];

export interface OutboundFrame {
  id: string;
  command: string;
  params: Record<string, unknown>;
}

export interface InboundSuccess {
  id: string;
  status: "success";
  result: unknown;
}

export interface InboundErrorDetail {
  code: string;
  message: string;
}

export interface InboundError {
  id: string;
  status: "error";
  error: InboundErrorDetail;
}

export type InboundFrame = InboundSuccess | InboundError;

// Normative MCP error shape (spec 1.3). Raw stack traces MUST NOT
// cross the MCP boundary.
export interface McpErrorMeta {
  code: string;
  retryable: boolean;
  hint?: string;
  command?: string;
  budget_ms?: number;
  hop?: string;
}

export interface McpErrorShape {
  content: [{ type: "text"; text: string }];
  isError: true;
  _meta: McpErrorMeta;
}

// Typed framing failure. Transports convert it with toMcp() instead of
// leaking the stack.
export class EnvelopeError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly hint?: string;
  readonly command?: string;

  constructor(code: string, message: string, opts?: { retryable?: boolean; hint?: string; command?: string }) {
    super(message);
    this.name = "EnvelopeError";
    this.code = code;
    this.retryable = opts?.retryable ?? false;
    this.hint = opts?.hint;
    this.command = opts?.command;
  }

  toMcp(): McpErrorShape {
    return toMcpError(this.code, this.message, {
      retryable: this.retryable,
      hint: this.hint,
      command: this.command,
    });
  }
}

// Minimal uuidv7 (RFC 9562): 48-bit unix-ms timestamp + version nibble
// + 74 random bits + variant bits. Node 18+ has no crypto.randomUUID v7.
export function uuidv7(nowMs: number = Date.now()): string {
  const rand = randomBytes(10);
  const timeHex = nowMs.toString(16).padStart(12, "0").slice(-12);
  const b0 = rand[0] ?? 0;
  const b1 = rand[1] ?? 0;
  const b2 = rand[2] ?? 0;
  const b3 = rand[3] ?? 0;
  const b4 = rand[4] ?? 0;
  const b5 = rand[5] ?? 0;
  const b6 = rand[6] ?? 0;
  const b7 = rand[7] ?? 0;
  const b8 = rand[8] ?? 0;
  const b9 = rand[9] ?? 0;
  const randA = ((b0 << 4) | (b1 >> 4)) & 0xfff;
  const randB = (((b1 & 0xf) << 8) | b2).toString(16).padStart(3, "0");
  const lo = [b3, b4, b5, b6, b7, b8, b9]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return (
    `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-` +
    `7${randA.toString(16).padStart(3, "0")}-` +
    `${(((b2 & 0x3) | 0x8).toString(16))}${randB}-` +
    `${lo.slice(0, 12)}`
  );
}

export function stripServerLocalOptions(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const blocked = new Set<string>(SERVER_LOCAL_OPTION_KEYS);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!blocked.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

export function byteLengthUtf8(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// Builds one outbound frame. Throws EnvelopeError(PAYLOAD_TOO_LARGE)
// when the serialized frame would exceed WS_PAYLOAD_CAP_BYTES.
export function buildOutboundFrame(
  command: string,
  params: Record<string, unknown> = {},
  opts?: { id?: string },
): OutboundFrame {
  if (command.length === 0) {
    throw new EnvelopeError("INVALID_FORMAT", "INVALID_FORMAT: missing field \"command\"", {
      retryable: false,
    });
  }
  const id = opts?.id ?? uuidv7();
  if (id.length === 0) {
    throw new EnvelopeError("INVALID_FORMAT", "INVALID_FORMAT: missing field \"id\"", {
      retryable: false,
    });
  }
  const frame: OutboundFrame = { id, command, params: stripServerLocalOptions(params) };
  const bytes = byteLengthUtf8(JSON.stringify(frame));
  if (bytes > WS_PAYLOAD_CAP_BYTES) {
    throw new EnvelopeError(
      "PAYLOAD_TOO_LARGE",
      `PAYLOAD_TOO_LARGE: outbound frame is ${bytes} bytes, cap is ${WS_PAYLOAD_CAP_BYTES}`,
      { retryable: true, hint: "retry with smaller args", command },
    );
  }
  return frame;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Parses one inbound frame. Accepts raw text or an already-parsed
// value. Success results pass through untouched (spec 1.2).
export function parseInboundFrame(raw: string | unknown): InboundFrame {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new EnvelopeError("PARSE_ERROR", "PARSE_ERROR: inbound text is not valid JSON", {
        retryable: false,
      });
    }
  }
  if (!isRecord(value)) {
    throw new EnvelopeError("INVALID_FORMAT", "INVALID_FORMAT: inbound frame must be an object", {
      retryable: false,
    });
  }
  const id = value["id"];
  const status = value["status"];
  if (typeof id !== "string" || id.length === 0) {
    throw new EnvelopeError("INVALID_FORMAT", "INVALID_FORMAT: missing field \"id\"", {
      retryable: false,
    });
  }
  if (status === "success") {
    return { id, status: "success", result: value["result"] };
  }
  if (status === "error") {
    const error = value["error"];
    if (!isRecord(error) || typeof error["code"] !== "string" || typeof error["message"] !== "string") {
      throw new EnvelopeError(
        "INVALID_FORMAT",
        "INVALID_FORMAT: error frame needs \"error.code\" and \"error.message\"",
        { retryable: false },
      );
    }
    return {
      id,
      status: "error",
      error: { code: error["code"], message: error["message"] },
    };
  }
  throw new EnvelopeError(
    "INVALID_FORMAT",
    "INVALID_FORMAT: missing field \"status\" (expected \"success\" or \"error\")",
    { retryable: false },
  );
}

export interface PendingEntry {
  resolve: (frame: InboundFrame) => void;
  reject: (err: EnvelopeError) => void;
  command: string;
}

export interface DropLogger {
  warn: (message: string) => void;
}

// Matches an inbound frame against pending calls. Frames with an
// unknown id are dropped and logged, resolving nothing (spec 1.2).
// Returns true when the frame matched a pending call.
export function routeInbound(
  frame: InboundFrame,
  pending: Map<string, PendingEntry>,
  log: DropLogger = console,
): boolean {
  const entry = pending.get(frame.id);
  if (entry === undefined) {
    log.warn(`godot-mcp-server: dropped inbound frame with unknown id "${frame.id}"`);
    return false;
  }
  pending.delete(frame.id);
  entry.resolve(frame);
  return true;
}

export function toMcpError(
  code: string,
  message: string,
  meta?: { retryable?: boolean; hint?: string; command?: string; budget_ms?: number; hop?: string },
): McpErrorShape {
  const full: McpErrorMeta = { code, retryable: meta?.retryable ?? false };
  if (meta?.hint !== undefined) full.hint = meta.hint;
  if (meta?.command !== undefined) full.command = meta.command;
  if (meta?.budget_ms !== undefined) full.budget_ms = meta.budget_ms;
  if (meta?.hop !== undefined) full.hop = meta.hop;
  return { content: [{ type: "text", text: message }], isError: true, _meta: full };
}

// Maps a relayed addon error {code,message} to the MCP error shape
// with the spec 1.3 retryable/hint policy for the framing codes.
export function addonErrorToMcp(
  error: InboundErrorDetail,
  opts?: { command?: string; budget_ms?: number; hop?: string },
): McpErrorShape {
  switch (error.code) {
    case "AUTH_REQUIRED":
      return toMcpError(error.code, error.message, {
        retryable: true,
        hint: "send auth first; token rotates per editor start_server",
        command: opts?.command,
      });
    case "AUTH_FAILED":
      return toMcpError(error.code, error.message, {
        retryable: true,
        hint: "re-read token from editor log / OOB channel, reconnect",
        command: opts?.command,
      });
    case "ALREADY_CONNECTED":
      return toMcpError(error.code, error.message, {
        retryable: true,
        hint: "retry with backoff / queue / hand off single editor session",
        command: opts?.command,
      });
    case "PAYLOAD_TOO_LARGE":
    case "RELAY_TIMEOUT":
      return toMcpError(error.code, error.message, {
        retryable: true,
        command: opts?.command,
        budget_ms: opts?.budget_ms,
        hop: opts?.hop,
      });
    case "UNKNOWN_COMMAND":
      return toMcpError(error.code, error.message, {
        retryable: false,
        command: opts?.command,
      });
    case "INVALID_FORMAT":
    case "PARSE_ERROR":
    default:
      return toMcpError(error.code, error.message, {
        retryable: false,
        command: opts?.command,
      });
  }
}
