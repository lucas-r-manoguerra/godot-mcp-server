// AC-04 + AC-08: spec section 6.1 matrix. Every row asserts the
// negotiated mode, the normative mode line in captured logs, and the
// mode on the server_status surface (absence fails the suite).
import { describe, expect, it } from "vitest";
import {
  createNegotiationWiring,
  formatNegotiationLine,
  negotiate,
  toServerStatusRecord,
  type NegotiationResult,
  type SendRpc,
} from "../src/godot/handshake.js";
import type { InboundFrame } from "../src/godot/envelope.js";
import { WsClient } from "../src/godot/wsClient.js";
import { registerServerStatusTool } from "../src/server/serverStatus.js";
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
const C = (name: string): J => resolveRefs(fx.cases[name]) as J;
const frame = (reply: unknown): InboundFrame => ({ id: "t", ...(reply as object) }) as InboundFrame;

function caplog(): { warns: string[]; infos: string[]; warn: (m: string) => void; info: (m: string) => void } {
  const warns: string[] = [];
  const infos: string[] = [];
  return { warns, infos, warn: (m) => warns.push(m), info: (m) => infos.push(m) };
}

function scripted(queues: Record<string, unknown[]>): { send: SendRpc; commands: string[] } {
  const commands: string[] = [];
  const send: SendRpc = async (command) => {
    commands.push(command);
    const q = queues[command];
    if (q === undefined || q.length === 0) throw new Error(`unstubbed "${command}"`);
    return frame(q.shift());
  };
  return { send, commands };
}

// Mode as seen on the server_status tool (design Q2 assertion surface).
async function statusMode(result: NegotiationResult): Promise<string> {
  let captured: (() => Promise<{ content: [{ text: string }] }>) | undefined;
  const fake = { registerTool: (_n: string, _d: unknown, h: () => Promise<{ content: [{ text: string }] }>) => {
    captured = h;
  } };
  registerServerStatusTool(fake as never, () => toServerStatusRecord(result));
  const out = await captured!();
  return (JSON.parse(out.content[0].text) as { mode: string }).mode;
}

async function expectRow(
  send: SendRpc,
  opts: { noAuth?: boolean },
  expectedMode: string,
): Promise<{ result: NegotiationResult; warns: string[] }> {
  const log = caplog();
  const result = await negotiate(send, { ...opts, resolveToken: async () => "tok", log });
  expect(result.mode).toBe(expectedMode);
  expect(log.infos).toContain(formatNegotiationLine(result.mode, result.capabilities));
  expect(await statusMode(result)).toBe(expectedMode);
  return { result, warns: log.warns };
}

describe("compat matrix (AC-04) + no silent downgrade (AC-08)", () => {
  it("auth-gated addon, default flag -> auth", async () => {
    const c = C("auth_gated_full");
    const { send } = scripted({ auth: [c["auth_reply"]], mcp_handshake: [c["handshake_reply"]] });
    await expectRow(send, {}, "auth");
  });

  it("auth-gated addon, --no-auth -> auth via switch-up (anti-downgrade 2.3a)", async () => {
    const c = C("auth_required_on_mismatch");
    const { send, commands } = scripted({
      mcp_handshake: [c["handshake_reply"], c["reauth_handshake_reply"]],
      auth: [c["auth_reply"]],
    });
    const { warns } = await expectRow(send, { noAuth: true }, "auth");
    expect(commands[0]).toBe("mcp_handshake");
    expect(warns.some((w) => w.includes("switching up to auth"))).toBe(true);
  });

  it("vanilla modern, --no-auth -> no-auth-full (handshake probed first)", async () => {
    const c = C("vanilla_modern_full");
    const { send, commands } = scripted({ mcp_handshake: [c["handshake_reply"]] });
    await expectRow(send, { noAuth: true }, "no-auth-full");
    expect(commands).toEqual(["mcp_handshake"]);
  });

  it("vanilla legacy, --no-auth -> no-auth-legacy (heartbeat fallback)", async () => {
    const c = C("vanilla_legacy");
    const { send, commands } = scripted({
      mcp_handshake: [c["handshake_reply"]],
      heartbeat: [c["heartbeat_reply"]],
    });
    const { result } = await expectRow(send, { noAuth: true }, "no-auth-legacy");
    expect(commands).toEqual(["mcp_handshake", "heartbeat"]);
    expect(result.capabilities.addon_version).toBe("unknown-legacy");
  });

  it("vanilla modern, default flag -> no-auth-full negotiated down VISIBLY (2.3b)", async () => {
    const c = C("vanilla_modern_full");
    const { send } = scripted({ auth: [c["auth_reply"]], mcp_handshake: [c["handshake_reply"]] });
    const { warns } = await expectRow(send, {}, "no-auth-full");
    expect(warns.some((w) => w.includes("visibly"))).toBe(true);
  });

  it("delayed relay -> RELAY_TIMEOUT, never null-with-success", async () => {
    const c = C("auth_gated_full");
    const peer = new StubPeer();
    peer.autoReply = ({ command }) => ({
      delay_ms: 1000,
      text: ({ id }) => {
        const reply = command === "auth" ? c["auth_reply"] : c["handshake_reply"];
        return JSON.stringify({ id, ...(reply as object) });
      },
    });
    const wiring = createNegotiationWiring({
      requestTimeoutMs: 50,
      tokenOptions: { env: { GODOT_MCP_TOKEN: "tok" } },
    });
    const client = new WsClient({
      connectSocket: () => peer.connect(),
      authenticate: wiring.authenticate,
      handshake: wiring.handshake,
      staleAfterMs: 60_000,
      log: peer.log,
    });
    await expect(client.connect()).rejects.toMatchObject({ code: "RELAY_TIMEOUT" });
    await client.close();
  });
});
