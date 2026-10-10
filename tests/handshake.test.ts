// AC-02: auth-first ordering, --no-auth probe order, byte-equal
// 5-field record, AUTH_FAILED retry-once, AUTH_REQUIRED switch-up.
import { describe, expect, it } from "vitest";
import { createNegotiationWiring, formatNegotiationLine, negotiate, type SendRpc } from "../src/godot/handshake.js";
import type { InboundFrame } from "../src/godot/envelope.js";
import { WsClient } from "../src/godot/wsClient.js";
import { StubPeer } from "./helpers/stubPeer.js";
import fixture from "./fixtures/handshake.json" with { type: "json" };

type J = Record<string, unknown>;
const fx = fixture as unknown as { full_record: J; cases: Record<string, J> };
function resolveRefs(value: unknown): unknown {
  if (value === "$full_record") return fx.full_record;
  if (Array.isArray(value)) return value.map(resolveRefs);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value as J).map(([k, v]) => [k, resolveRefs(v)]));
  }
  return value;
}
const full = fx.full_record;
const C = (name: string): J => resolveRefs(fx.cases[name]) as J;
const frame = (reply: unknown, id = "t"): InboundFrame =>
  ({ id, ...(reply as object) }) as InboundFrame;

function scripted(queues: Record<string, unknown[]>): { send: SendRpc; commands: string[] } {
  const commands: string[] = [];
  const send: SendRpc = async (command, params) => {
    commands.push(command);
    void params;
    const q = queues[command];
    if (q === undefined || q.length === 0) throw new Error(`unstubbed command "${command}"`);
    return frame(q.shift());
  };
  return { send, commands };
}

function caplog(): { warns: string[]; infos: string[]; warn: (m: string) => void; info: (m: string) => void } {
  const warns: string[] = [];
  const infos: string[] = [];
  return { warns, infos, warn: (m) => warns.push(m), info: (m) => infos.push(m) };
}

describe("handshake (AC-02)", () => {
  it("sends auth first and records the 5-field capability byte-equal", async () => {
    const c = C("auth_gated_full");
    const { send, commands } = scripted({ auth: [c["auth_reply"]], mcp_handshake: [c["handshake_reply"]] });
    const log = caplog();
    const out = await negotiate(send, { resolveToken: async () => "tok", log });
    expect(commands[0]).toBe("auth");
    expect(commands).toEqual(["auth", "mcp_handshake"]);
    expect(out.mode).toBe("auth");
    expect(out.capabilities).toEqual(full);
    expect(out.protocol_drift_suspected).toBe(false);
    expect(log.infos).toContain(formatNegotiationLine("auth", out.capabilities));
  });

  it("probes mcp_handshake first under --no-auth (modern full, legacy heartbeat)", async () => {
    const modern = C("vanilla_modern_full");
    const s1 = scripted({ mcp_handshake: [modern["handshake_reply"]] });
    const log1 = caplog();
    const r1 = await negotiate(s1.send, { noAuth: true, log: log1 });
    expect(s1.commands).toEqual(["mcp_handshake"]);
    expect(r1.mode).toBe("no-auth-full");
    expect(r1.capabilities).toEqual(full);

    const legacy = C("vanilla_legacy");
    const s2 = scripted({ mcp_handshake: [legacy["handshake_reply"]], heartbeat: [legacy["heartbeat_reply"]] });
    const r2 = await negotiate(s2.send, { noAuth: true, log: caplog() });
    expect(s2.commands).toEqual(["mcp_handshake", "heartbeat"]);
    expect(r2.mode).toBe("no-auth-legacy");
    expect(r2.capabilities.addon_version).toBe("unknown-legacy");
  });

  it("switches up to auth on AUTH_REQUIRED (never a silent downgrade)", async () => {
    const c = C("auth_required_on_mismatch");
    const { send, commands } = scripted({
      mcp_handshake: [c["handshake_reply"], c["reauth_handshake_reply"]],
      auth: [c["auth_reply"]],
    });
    const log = caplog();
    const out = await negotiate(send, { noAuth: true, resolveToken: async () => "tok", log });
    expect(out.mode).toBe("auth");
    expect(commands).toEqual(["mcp_handshake", "auth", "mcp_handshake"]);
    expect(log.warns.some((w) => w.includes("AUTH_REQUIRED") && w.includes("switching up"))).toBe(true);
    expect(log.infos).toContain(formatNegotiationLine("auth", out.capabilities));
  });

  it("re-reads the token once on AUTH_FAILED, then surfaces (no loop)", async () => {
    const c = C("auth_failed_once_then_success");
    const seen: string[] = [];
    let calls = 0;
    const tokens = [c["first_token"] as string, c["good_token"] as string];
    const send: SendRpc = async (command, params) => {
      if (command === "auth") seen.push((params as { token: string }).token);
      const replies = command === "auth" ? (c["auth_replies"] as unknown[]) : [c["handshake_reply"]];
      return frame(replies[Math.min(calls++, replies.length - 1)]);
    };
    const out = await negotiate(send, { resolveToken: async () => tokens.shift() as string, log: caplog() });
    expect(seen).toEqual([c["first_token"], c["good_token"]]);
    expect(out.mode).toBe("auth");

    const alwaysFail: SendRpc = async () => frame({ status: "error", error: { code: "AUTH_FAILED", message: "nope" } });
    await expect(negotiate(alwaysFail, { resolveToken: async () => "x", log: caplog() })).rejects.toMatchObject({
      code: "AUTH_FAILED",
    });
  });

  it("fails loudly on a missing capability field and flags drift without aborting", async () => {
    const missing: SendRpc = async (command) =>
      command === "auth"
        ? frame({ status: "success", result: { ok: true } })
        : frame({ status: "success", result: { addon_version: "4.1.11" } });
    await expect(negotiate(missing, { resolveToken: async () => "t", log: caplog() })).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });

    const drifted: SendRpc = async (command) =>
      command === "auth"
        ? frame({ status: "success", result: { ok: true } })
        : frame({ status: "success", result: { ...full, addon_version: "4.0.0", godot_version: "4.3" } });
    const log = caplog();
    const out = await negotiate(drifted, { resolveToken: async () => "t", log });
    expect(out.mode).toBe("auth");
    expect(out.protocol_drift_suspected).toBe(true);
    expect(log.warns.length).toBeGreaterThan(0);
  });

  it("wires into the WsClient T3 hooks with auth as the first frame", async () => {
    const c = C("auth_gated_full");
    const peer = new StubPeer();
    peer.autoReply = ({ command }) => {
      if (command === "auth") return { text: ({ id }) => JSON.stringify({ id, ...(c["auth_reply"] as object) }) };
      if (command === "mcp_handshake") return { text: ({ id }) => JSON.stringify({ id, ...(c["handshake_reply"] as object) }) };
      return null;
    };
    const wiring = createNegotiationWiring({ tokenOptions: { env: { GODOT_MCP_TOKEN: "tok" } } });
    const client = new WsClient({
      connectSocket: () => peer.connect(),
      authenticate: wiring.authenticate,
      handshake: wiring.handshake,
      staleAfterMs: 60_000,
      log: peer.log,
    });
    await client.connect();
    expect(peer.inbound[0]?.command).toBe("auth");
    expect(peer.inbound.map((f) => f.command)).toEqual(["auth", "mcp_handshake"]);
    expect(wiring.getResult()?.mode).toBe("auth");
    expect(wiring.getResult()?.capabilities).toEqual(full);
    await client.close();
  });
});
