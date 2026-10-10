// Stub WS peer for editor-free tests (design 4.1, first cut). An
// in-memory fake: records inbound frames in arrival order, replays
// scripted replies with optional delay, and simulates close codes
// (4001 contention) plus socket destroy (transport drop).

import type { WsSocket } from "../../src/godot/wsClient.js";

export interface StubReply {
  // Raw text delivered back to the client (default: success echo).
  text?: (inbound: { id: string; command: string }) => string;
  delay_ms?: number;
}

export class StubPeer {
  // Inbound frames from the client, arrival order (parse to JSON).
  readonly inbound: Array<{ id: string; command: string; params: unknown }> = [];
  readonly warnings: string[] = [];
  autoReply: ((frame: { id: string; command: string }) => StubReply | null) | null = null;
  private sockets = new Set<StubSocket>();

  connect(): Promise<WsSocket> {
    const socket = new StubSocket(this);
    this.sockets.add(socket);
    return Promise.resolve(socket);
  }

  replyTo(id: string, result: unknown, delayMs = 0): void {
    const text = JSON.stringify({ id, status: "success", result });
    const t = setTimeout(() => this.deliver(text), delayMs);
    t.unref?.();
  }

  closePeer(code: number, reason = ""): void {
    for (const socket of this.sockets) socket.fireClose(code, reason);
  }

  destroyPeer(): void {
    for (const socket of this.sockets) socket.fireDestroy();
    this.sockets.clear();
  }

  readonly log = {
    warn: (message: string): void => {
      this.warnings.push(message);
    },
  };

  // -- internal (socket-facing) ----------------------------------

  receive(socket: StubSocket, text: string): void {
    void socket;
    const parsed = JSON.parse(text) as { id: string; command: string; params: unknown };
    this.inbound.push(parsed);
    const reply = this.autoReply?.({ id: parsed.id, command: parsed.command });
    if (reply === null || reply === undefined) return;
    const make = reply.text ?? (({ id }) => JSON.stringify({ id, status: "success", result: { ok: true } }));
    const out = make({ id: parsed.id, command: parsed.command });
    const t = setTimeout(() => this.deliver(out), reply.delay_ms ?? 0);
    t.unref?.();
  }

  private deliver(text: string): void {
    for (const socket of this.sockets) socket.fireMessage(text);
  }
}

class StubSocket implements WsSocket {
  onMessage: ((text: string) => void) | null = null;
  onClose: ((code: number, reason: string) => void) | null = null;
  closed = false;

  constructor(private readonly peer: StubPeer) {}

  send(text: string): void {
    if (this.closed) throw new Error("socket is closed");
    this.peer.receive(this, text);
  }

  close(_code?: number, _reason?: string): void {
    this.closed = true;
  }

  fireMessage(text: string): void {
    if (!this.closed) this.onMessage?.(text);
  }

  fireClose(code: number, reason: string): void {
    this.closed = true;
    this.onClose?.(code, reason);
  }

  // Abrupt TCP drop: abnormal-closure code, no clean frame.
  fireDestroy(): void {
    this.closed = true;
    this.onClose?.(1006, "connection destroyed");
  }
}
