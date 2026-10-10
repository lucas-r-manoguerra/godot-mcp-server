// Production WS socket factory: fills the Task 3 connectSocket hook so
// the factory-owned WsClient can reach the running editor. Uses the
// platform WebSocket (Node 22+ global, no extra dependency) and fails
// fast with an actionable error when no editor is listening — never a
// hang. Negotiation frames stay in handshake.ts; this module only opens
// the transport.

import { BRIDGE_READY_TIMEOUT_MS } from "./budgets.js";
import type { WsSocket } from "./wsClient.js";

export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 6550;

export interface ConnectSocketOptions {
  host?: string;
  port?: number;
  connectTimeoutMs?: number;
}

// Minimal structural surface so src stays DOM-lib free (tsconfig lib
// is ES2022 + node types only).
interface PlatformSocket {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: string, listener: (event: PlatformEvent) => void) => void;
}

interface PlatformEvent {
  data?: unknown;
  code?: unknown;
  reason?: unknown;
}

type PlatformSocketCtor = new (url: string) => PlatformSocket;

export function bridgeWsUrl(host: string, port: number): string {
  return `ws://${host}:${port}`;
}

function remediation(url: string, detail: string): Error {
  return new Error(
    `not connected: cannot reach the Godot editor at ${url} (${detail}); ` +
      `start the editor with the godot_mcp addon enabled`,
  );
}

function messageText(data: unknown): string | Promise<string> | null {
  if (typeof data === "string") return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return null;
}

// Opens one transport socket. Rejects (fast: refused or the
// bridge-ready budget) when no editor is present.
export function connectWsSocket(opts: ConnectSocketOptions = {}): Promise<WsSocket> {
  const host = opts.host ?? DEFAULT_BRIDGE_HOST;
  const port = opts.port ?? DEFAULT_BRIDGE_PORT;
  const timeoutMs = opts.connectTimeoutMs ?? BRIDGE_READY_TIMEOUT_MS;
  const url = bridgeWsUrl(host, port);
  const Ctor = (globalThis as unknown as { WebSocket?: PlatformSocketCtor }).WebSocket;
  if (typeof Ctor !== "function") {
    return Promise.reject(
      remediation(url, "no WebSocket implementation in this runtime"),
    );
  }
  return new Promise<WsSocket>((resolve, reject) => {
    let settled = false;
    const ws: PlatformSocket = new Ctor(url);
    const timer = setTimeout(() => fail(`no response within ${timeoutMs}ms`), timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    const fail = (detail: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Socket never opened; nothing to release.
      }
      reject(remediation(url, detail));
    };
    let adapter: WsSocket | null = null;
    ws.addEventListener("message", (event) => {
      if (adapter === null) return;
      const text = messageText(event.data);
      if (text === null) return;
      if (typeof text === "string") adapter.onMessage?.(text);
      else void text.then((t) => adapter?.onMessage?.(t));
    });
    ws.addEventListener("close", (event) => {
      const code = typeof event.code === "number" ? event.code : 1006;
      const reason = typeof event.reason === "string" ? event.reason : "";
      adapter?.onClose?.(code, reason);
    });
    // Post-open errors surface through the close handler above; only
    // pre-open errors reject the connect itself.
    ws.addEventListener("error", () => fail("connection refused"));
    ws.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      adapter = {
        send: (text: string): void => ws.send(text),
        close: (code?: number, reason?: string): void => {
          try {
            ws.close(code, reason);
          } catch {
            // Already torn down; close() stays idempotent.
          }
        },
        onMessage: null,
        onClose: null,
      };
      resolve(adapter);
    });
  });
}
