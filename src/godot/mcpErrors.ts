// MCP error vocabulary (spec 1.3; T1a slice of T1, split out of
// envelope.ts): inbound frame types, the normative MCP error shape,
// the typed framing failure, and the addon-error retry policy.
// Guards (scopedPath) share this module without importing framing
// rules. Raw stack traces MUST NOT cross the MCP boundary.

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
