// Single-connection WS client (specs 1.1-1.3, 5; design 2.1-2.4).
// Owns correlation state, FIFO multiplex, timers, and reconnect.
// No tool logic: every command funnels through call(). Auth and
// handshake frames belong to Task 4; this slice exposes them as
// injectable hooks so the state machine already walks
// DISCONNECTED -> CONNECTING -> AUTHENTICATING -> HANDSHAKING -> READY.

import {
  buildOutboundFrame,
  EnvelopeError,
  parseInboundFrame,
  routeInbound,
  toMcpError,
  uuidv7,
  type InboundFrame,
  type McpErrorShape,
  type PendingEntry,
} from "./envelope.js";
import { relayTimeoutFor } from "./budgets.js";

export type ClientState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "AUTHENTICATING"
  | "HANDSHAKING"
  | "READY"
  | "RECONNECTING"
  | "CLOSED";

// Minimal socket surface. Production code injects a real WS socket
// (Task 4 wiring); tests inject the stub peer. No extra dependency.
export interface WsSocket {
  send: (text: string) => void;
  close: (code?: number, reason?: string) => void;
  onMessage: ((text: string) => void) | null;
  onClose: ((code: number, reason: string) => void) | null;
}

export interface WsClientOptions {
  connectSocket: () => Promise<WsSocket>;
  // Re-resolves the OOB token before a reconnect (Task 4 owns sources).
  resolveToken?: () => Promise<void>;
  // Single auth / handshake passes (Task 4 owns the frames).
  authenticate?: (socket: WsSocket) => Promise<void>;
  handshake?: (socket: WsSocket) => Promise<void>;
  budgetFor?: (command: string, overrideMs?: number) => number;
  maxReconnectAttempts?: number;
  staleAfterMs?: number;
  log?: { warn: (message: string) => void };
}

interface FullEntry extends PendingEntry {
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
  budgetMs: number;
}

interface QueuedCall {
  command: string;
  params: Record<string, unknown>;
  overrideMs?: number;
  resolve: (frame: InboundFrame) => void;
  reject: (err: EnvelopeError) => void;
}

// Server-side timeout surfaced as a typed error (spec 1.3: code +
// hop + budget_ms, retryable, never null-with-success).
export class RelayTimeoutError extends EnvelopeError {
  readonly budget_ms: number;
  readonly hop = "ws-roundtrip";
  constructor(command: string, budgetMs: number) {
    super(
      "RELAY_TIMEOUT",
      `RELAY_TIMEOUT: "${command}" exceeded ws-roundtrip budget of ${budgetMs}ms`,
      { retryable: true, command },
    );
    this.budget_ms = budgetMs;
  }
  override toMcp(): McpErrorShape {
    return toMcpError(this.code, this.message, {
      retryable: this.retryable,
      command: this.command,
      budget_ms: this.budget_ms,
      hop: this.hop,
    });
  }
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  const t = timer as unknown as { unref?: () => void };
  if (typeof t.unref === "function") t.unref();
}

const OCCUPIED_HINT = "retry with backoff / queue / hand off single editor session";

export class WsClient {
  private state: ClientState = "DISCONNECTED";
  private socket: WsSocket | null = null;
  private readonly pending = new Map<string, FullEntry>();
  private readonly queue: QueuedCall[] = [];
  private inFlight: string | null = null;
  private reconnectAttempts = 0;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: Required<
    Pick<WsClientOptions, "budgetFor" | "log">
  > &
    WsClientOptions;

  constructor(opts: WsClientOptions) {
    this.opts = {
      ...opts,
      budgetFor: opts.budgetFor ?? relayTimeoutFor,
      log: opts.log ?? console,
    };
  }

  getState(): ClientState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === "READY" || this.state === "CLOSED") return;
    this.transition("CONNECTING");
    this.socket = await this.connectSocketOrThrow();
    await this.runNegotiation(this.socket);
    this.transition("READY");
    this.pump();
  }

  // Sends one command FIFO. Resolves the inbound frame on success;
  // rejects with EnvelopeError on error frames, timeouts, or drops.
  call(
    command: string,
    params: Record<string, unknown> = {},
    opts?: { timeout_ms?: number },
  ): Promise<InboundFrame> {
    if (this.state === "CLOSED") {
      return Promise.reject(
        new EnvelopeError("RELAY_TIMEOUT", `RELAY_TIMEOUT: client is closed ("${command}" never sent)`, {
          retryable: false,
          command,
        }),
      );
    }
    return new Promise<InboundFrame>((resolve, reject) => {
      this.queue.push({ command, params, overrideMs: opts?.timeout_ms, resolve, reject });
      this.pump();
    });
  }

  async close(): Promise<void> {
    if (this.state === "CLOSED") return;
    this.transition("CLOSED");
    this.clearStaleTimer();
    try {
      this.socket?.close(1000, "client shutdown");
    } finally {
      this.socket = null;
    }
    // Spec 2.1: shutdown resolves in-flight RELAY_TIMEOUT ws-roundtrip.
    this.failAll(new RelayTimeoutError("shutdown", this.opts.budgetFor("shutdown")));
  }

  // -- internals -------------------------------------------------

  private transition(next: ClientState): void {
    this.state = next;
  }

  private async connectSocketOrThrow(): Promise<WsSocket> {
    const socket = await this.opts.connectSocket();
    socket.onMessage = (text) => this.onText(text);
    socket.onClose = (code, reason) => void this.onClose(code, reason);
    return socket;
  }

  private async runNegotiation(socket: WsSocket): Promise<void> {
    this.transition("AUTHENTICATING");
    await this.opts.authenticate?.(socket);
    this.transition("HANDSHAKING");
    await this.opts.handshake?.(socket);
  }

  // FIFO: one frame in flight; only READY sends.
  private pump(): void {
    if (this.state !== "READY" || this.inFlight !== null || this.socket === null) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    let frame;
    try {
      frame = buildOutboundFrame(next.command, next.params);
    } catch (err) {
      next.reject(err as EnvelopeError);
      this.pump();
      return;
    }
    if (this.pending.has(frame.id)) {
      next.reject(
        new EnvelopeError("INVALID_FORMAT", `INVALID_FORMAT: id "${frame.id}" is already live`, {
          retryable: false,
          command: next.command,
        }),
      );
      this.pump();
      return;
    }
    const budgetMs = this.opts.budgetFor(next.command, next.overrideMs);
    const id = frame.id;
    const timer = setTimeout(() => this.onBudgetBreach(id), budgetMs);
    unref(timer);
    this.pending.set(id, {
      resolve: next.resolve,
      reject: next.reject,
      command: next.command,
      timer,
      startedAt: Date.now(),
      budgetMs,
    });
    this.inFlight = id;
    this.socket.send(JSON.stringify(frame));
    this.armStaleTimer();
  }

  private onBudgetBreach(id: string): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return; // late: already settled, drop rule.
    this.pending.delete(id);
    if (this.inFlight === id) this.inFlight = null;
    entry.reject(new RelayTimeoutError(entry.command, entry.budgetMs));
    this.pump();
  }

  private onText(text: string): void {
    this.armStaleTimer();
    let frame: InboundFrame;
    try {
      frame = parseInboundFrame(text);
    } catch (err) {
      this.attributeParseFailure(err as EnvelopeError);
      return;
    }
    const entry = this.pending.get(frame.id);
    const matched = routeInbound(frame, this.pending, this.opts.log);
    if (!matched || entry === undefined) return;
    clearTimeout(entry.timer);
    if (this.inFlight === frame.id) this.inFlight = null;
    if (frame.status === "error") {
      entry.reject(
        new EnvelopeError(frame.error.code, `${frame.error.code}: ${frame.error.message}`, {
          retryable: frame.error.code === "ALREADY_CONNECTED",
          hint: frame.error.code === "ALREADY_CONNECTED" ? OCCUPIED_HINT : undefined,
          command: entry.command,
        }),
      );
    }
    this.pump();
  }

  // PARSE_ERROR (or INVALID_FORMAT on garbage) attributes to the
  // oldest pending call only when unambiguous; else log + drop so a
  // corrupt frame never resolves a foreign call.
  private attributeParseFailure(err: EnvelopeError): void {
    if (this.pending.size === 1) {
      const [id, entry] = [...this.pending.entries()][0] as [string, FullEntry];
      this.pending.delete(id);
      if (this.inFlight === id) this.inFlight = null;
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pump();
      return;
    }
    this.opts.log.warn(`godot-mcp-server: dropped unparseable inbound frame (${err.code})`);
  }

  private onClose(code: number, reason: string): void {
    if (this.state === "CLOSED" || this.state === "RECONNECTING") return;
    this.socket = null;
    if (code === 4001) {
      this.onOccupied(reason);
      return;
    }
    void this.reconnect(reason || `transport close ${code}`);
  }

  // 4001 / ALREADY_CONNECTED: bridge held by another client. Every
  // current and queued-but-unsent call resolves the actionable error
  // immediately; NO reconnect against an occupied bridge.
  private onOccupied(reason: string): void {
    this.transition("DISCONNECTED");
    const detail = reason.length > 0 ? `: ${reason}` : "";
    this.failAll(
      new EnvelopeError(
        "ALREADY_CONNECTED",
        `ALREADY_CONNECTED: bridge is held by another client${detail}`,
        { retryable: true, hint: OCCUPIED_HINT },
      ),
    );
  }

  private async reconnect(why: string): Promise<void> {
    this.transition("RECONNECTING");
    // In-flight-at-drop is never silently retried: the caller decides.
    if (this.inFlight !== null) {
      const entry = this.pending.get(this.inFlight);
      this.pending.delete(this.inFlight);
      this.inFlight = null;
      if (entry !== undefined) {
        clearTimeout(entry.timer);
        entry.reject(new RelayTimeoutError(entry.command, entry.budgetMs));
      }
    }
    const max = this.opts.maxReconnectAttempts ?? 3;
    while (this.state === "RECONNECTING" && this.reconnectAttempts < max) {
      this.reconnectAttempts += 1;
      try {
        await this.opts.resolveToken?.();
        const socket = await this.connectSocketOrThrow();
        this.socket = socket;
        await this.runNegotiation(socket);
        this.reconnectAttempts = 0;
        this.transition("READY");
        this.opts.log.warn(`godot-mcp-server: reconnected after ${why}; replaying ${this.queue.length} queued call(s) with fresh ids`);
        this.pump(); // replay builds fresh ids per frame (old ids are dead).
        return;
      } catch (err) {
        this.opts.log.warn(
          `godot-mcp-server: reconnect attempt ${this.reconnectAttempts}/${max} failed (${(err as Error).message})`,
        );
      }
    }
    if (this.state === "RECONNECTING") {
      // Budget exhausted: no call hangs past its roundtrip budget.
      this.transition("DISCONNECTED");
      this.failAll(
        new EnvelopeError("RELAY_TIMEOUT", `RELAY_TIMEOUT: reconnect failed after ${max} attempt(s) (${why})`, {
          retryable: true,
        }),
      );
    }
  }

  // Stale reap (>45 s silence, spec 1.3): transport drop path.
  private armStaleTimer(): void {
    this.clearStaleTimer();
    if (this.state === "CLOSED") return;
    const after = this.opts.staleAfterMs ?? 45_000;
    this.staleTimer = setTimeout(() => {
      if (this.state === "READY") void this.reconnect("stale connection (>45s silence)");
    }, after);
    unref(this.staleTimer);
  }

  private clearStaleTimer(): void {
    if (this.staleTimer !== null) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private failAll(err: EnvelopeError): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
    this.inFlight = null;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.reject(err);
    }
  }
}

export function createWsClient(opts: WsClientOptions): WsClient {
  return new WsClient(opts);
}
