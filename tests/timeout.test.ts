// AC-05 + FIFO/reconnect/4001 ordering assertions against the stub
// peer (tasks.md Task 3). Error results are coded envelopes, never
// null-with-success.

import { describe, expect, it } from "vitest";
import { EnvelopeError } from "../src/godot/envelope.js";
import { RelayTimeoutError, WsClient } from "../src/godot/wsClient.js";
import { StubPeer } from "./helpers/stubPeer.js";

function clientFor(peer: StubPeer, budgetMs = 150): WsClient {
  return new WsClient({
    connectSocket: () => peer.connect(),
    budgetFor: () => budgetMs,
    staleAfterMs: 60_000,
    log: peer.log,
  });
}

describe("ws roundtrip timeout (AC-05)", () => {
  it("resolves RELAY_TIMEOUT with hop + budget_ms, never null-with-success", async () => {
    const peer = new StubPeer();
    peer.autoReply = () => ({ delay_ms: 1150 }); // budget + 1000ms
    const client = clientFor(peer);
    await client.connect();
    const outcome = await client.call("get_scene_tree").then(
      () => ({ settled: "resolved" as const }),
      (err: unknown) => ({ settled: "rejected" as const, err: err as EnvelopeError & { budget_ms?: number; hop?: string } }),
    );
    expect(outcome.settled).toBe("rejected");
    if (outcome.settled === "rejected") {
      expect(outcome.err.code).toBe("RELAY_TIMEOUT");
      expect(outcome.err).toBeInstanceOf(RelayTimeoutError);
      expect(outcome.err.hop).toBe("ws-roundtrip");
      expect(outcome.err.budget_ms).toBe(150);
      const mcp = (outcome.err as RelayTimeoutError).toMcp();
      expect(mcp.isError).toBe(true);
      expect(mcp._meta.code).toBe("RELAY_TIMEOUT");
    }
    await client.close();
  });
});

describe("fifo multiplex", () => {
  it("sends arrival-ordered, one frame in flight", async () => {
    const peer = new StubPeer();
    peer.autoReply = ({ id }) => ({ text: () => JSON.stringify({ id, status: "success", result: id }) });
    const client = clientFor(peer);
    await client.connect();
    const [a, b, c] = await Promise.all([
      client.call("cmd_a"),
      client.call("cmd_b"),
      client.call("cmd_c"),
    ]);
    expect(peer.inbound.map((f) => f.command)).toEqual(["cmd_a", "cmd_b", "cmd_c"]);
    expect([a, b, c].map((f) => f.status)).toEqual(["success", "success", "success"]);
    await client.close();
  });
});

describe("reconnect", () => {
  it("fails in-flight with RELAY_TIMEOUT and replays queued FIFO with fresh ids", async () => {
    const peer = new StubPeer();
    let hold = true;
    peer.autoReply = ({ id }) =>
      hold ? null : { text: () => JSON.stringify({ id, status: "success", result: "replayed" }) };
    const client = clientFor(peer);
    await client.connect();
    const first = client.call("cmd_first"); // in flight, held
    const second = client.call("cmd_second"); // queued
    await new Promise((r) => setTimeout(r, 20));
    const deadIds = peer.inbound.map((f) => f.id);
    peer.destroyPeer(); // transport drop mid-flight
    hold = false;
    await expect(first).rejects.toMatchObject({ code: "RELAY_TIMEOUT" });
    await expect(second).resolves.toMatchObject({ status: "success" });
    const replayed = peer.inbound.filter((f) => f.command === "cmd_second");
    expect(replayed).toHaveLength(1);
    expect(deadIds).not.toContain(replayed[0]?.id); // fresh id
    expect(client.getState()).toBe("READY");
    await client.close();
  });
});

describe("4001 contention", () => {
  it("resolves the actionable error immediately without reconnect", async () => {
    const peer = new StubPeer();
    peer.autoReply = () => null; // hold everything queued
    const client = clientFor(peer);
    await client.connect();
    const pending = client.call("cmd_held");
    const queued = client.call("cmd_queued");
    await new Promise((r) => setTimeout(r, 20));
    peer.closePeer(4001, "already connected");
    await expect(pending).rejects.toMatchObject({ code: "ALREADY_CONNECTED" });
    await expect(queued).rejects.toMatchObject({ code: "ALREADY_CONNECTED" });
    expect(client.getState()).toBe("DISCONNECTED");
    await client.close();
  });
});
