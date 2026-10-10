// Budget foundations (spec 5): relay_timeout_ms cascade, 256 KB
// result cap helper, screenshot maxWidth default.

export const RELAY_TIMEOUT_MS_DEFAULT = 15000;
export const BRIDGE_READY_TIMEOUT_MS = 5000;
export const GAME_RELAY_TIMEOUT_MS = 10000;
export const WS_ROUNDTRIP_TIMEOUT_MS = 15000;
export const EXTENDED_TIMEOUT_MS = 60000;

// Per-tool override class: these commands race a 60 s budget.
export const EXTENDED_BUDGET_COMMANDS: ReadonlySet<string> = new Set([
  "trace_signal",
  "execute_input_sequence",
  "type_text",
  "verify",
]);

export type RelayHop = "bridge-ready" | "game-relay" | "ws-roundtrip";

// Resolves the ws-roundtrip budget for a command. An explicit
// override (client config) wins; otherwise the extended class wins;
// otherwise the default applies.
export function relayTimeoutFor(command: string, overrideMs?: number): number {
  if (overrideMs !== undefined) {
    return overrideMs;
  }
  if (EXTENDED_BUDGET_COMMANDS.has(command)) {
    return EXTENDED_TIMEOUT_MS;
  }
  return RELAY_TIMEOUT_MS_DEFAULT;
}

// Per-tool result cap (spec 5). Oversize results truncate explicitly,
// never silently.
export const RESULT_CAP_BYTES = 256 * 1024;

export interface TruncatedResult {
  text: string;
  truncated: boolean;
  total: number;
}

export function truncateResultText(text: string, cap: number = RESULT_CAP_BYTES): TruncatedResult {
  const total = Buffer.byteLength(text, "utf8");
  if (total <= cap) {
    return { text, truncated: false, total };
  }
  let end = cap;
  while (end > 0 && (text.charCodeAt(end) ?? 0) >= 0x80 && (text.charCodeAt(end) ?? 0) < 0xc0) {
    end -= 1;
  }
  return { text: text.slice(0, end), truncated: true, total };
}

// Screenshot economy (spec 5): downscale request before send; the
// 16 MB WS buffer stays the hard ceiling.
export const SCREENSHOT_DEFAULT_MAX_WIDTH = 1280;
export const SCREENSHOT_DEFAULT_FORMAT = "png";

export function resolveScreenshotMaxWidth(explicit?: number): number {
  return explicit ?? SCREENSHOT_DEFAULT_MAX_WIDTH;
}
