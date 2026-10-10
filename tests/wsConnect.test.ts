// Regression for the live "not connected" bug: buildServer() wired
// ctx.send to a stub that always threw, while WsClient + negotiate()
// existed unconnected — the server never opened the editor socket.
// These tests prove the first tool call lazy-connects (race-safe),
// negotiates auth-first, runs the command, and that the project-dir
// triad feeds the status-file token source.
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server/buildServer.js";
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
const full = fx.full_record as Record<string, unknown>;
const gated = resolveRefs(fx.cases["auth_gated_full"]) as Record<string, J>;

function caplog(): { warns: string[]; infos: string[]; warn: (m: string) => void; info: (m: string) => void } {
  const warns: string[] = [];
  const infos: string[] = [];
  return { warns, infos, warn: (m) => warns.push(m), info: (m) => infos.push(m) };
}

// Auth-gated stub editor: auth -> mcp_handshake -> any command echo.
function gatedPeer(extra?: (frame: { id: string; command: string }) => { text: (f: { id: string }) => string } | null): StubPeer {
  const peer = new StubPeer();
  peer.autoReply = (frame) => {
    if (frame.command === "auth") {
      return { text: ({ id }) => JSON.stringify({ id, ...(gated["auth_reply"] as object) }) };
    }
    if (frame.command === "mcp_handshake") {
      return { text: ({ id }) => JSON.stringify({ id, ...(gated["handshake_reply"] as object) }) };
    }
    const handled = extra?.(frame);
    if (handled !== undefined && handled !== null) return handled;
    return { text: ({ id }) => JSON.stringify({ id, status: "success", result: { ok: true } }) };
  };
  return peer;
}

describe("lazy WS connect (live not-connected regression)", () => {
  it("first tool call connects, negotiates auth-first, then runs the command", async () => {
    const peer = gatedPeer(({ command }) =>
      command === "class_list"
        ? { text: ({ id }) => JSON.stringify({ id, status: "success", result: { classes: ["Node"], total: 1 } }) }
        : null,
    );
    const log = caplog();
    const built = buildServer({
      connectSocket: () => peer.connect(),
      env: { GODOT_MCP_TOKEN: "tok" },
      log,
    });
    const def = built.registry.resolve("class_list");
    if (def === undefined) throw new Error("class_list not registered");
    const out = await def.handler({ limit: 200 }, built.ctx);
    expect(out).toEqual({ classes: ["Node"], total: 1 });
    // Auth-first ordering: auth, handshake, THEN the command.
    expect(peer.inbound.map((f) => f.command)).toEqual(["auth", "mcp_handshake", "class_list"]);
    expect(built.ctx.capabilities.mode).toBe("auth");
    expect(built.ctx.capabilities.addon_version).toBe(full["addon_version"]);
    expect(built.ctx.capabilities.godot_version).toBe(full["godot_version"]);
    expect(built.ctx.capabilities.project_path).toBe(full["project_path"]);
    expect(built.ctx.mode).toBe("auth");
    expect(log.infos.some((l) => l.includes("negotiated mode=auth"))).toBe(true);
    // Second call reuses the connection: no re-handshake.
    await def.handler({}, built.ctx);
    expect(peer.inbound.map((f) => f.command)).toEqual([
      "auth",
      "mcp_handshake",
      "class_list",
      "class_list",
    ]);
    await built.client.close();
  });

  it("concurrent first calls share one connection in flight", async () => {
    const peer = gatedPeer();
    let connects = 0;
    const built = buildServer({
      connectSocket: () => {
        connects += 1;
        return peer.connect();
      },
      env: { GODOT_MCP_TOKEN: "tok" },
      log: caplog(),
    });
    const [a, b] = await Promise.all([
      built.ctx.send("class_list", {}),
      built.ctx.send("get_scene_tree", {}),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(connects).toBe(1);
    expect(peer.inbound.filter((f) => f.command === "auth")).toHaveLength(1);
    await built.client.close();
  });

  it("without an editor the first call fails fast with an actionable error (no hang)", async () => {
    const port = await new Promise<number>((resolve) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address();
        const picked = typeof addr === "object" && addr !== null ? addr.port : 9;
        s.close(() => resolve(picked));
      });
    });
    const built = buildServer({ bridgePort: port, log: caplog() });
    const started = Date.now();
    const first = await built.ctx.send("class_list", {}).then(
      () => ({ settled: "resolved" as const }),
      (err: unknown) => ({ settled: "rejected" as const, message: (err as Error).message }),
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(first.settled).toBe("rejected");
    if (first.settled === "rejected") {
      expect(first.message).toMatch(/cannot reach the Godot editor at ws:\/\/127\.0\.0\.1/);
      expect(first.message).toMatch(/godot_mcp addon/);
    }
    // Failure is not cached: the next call retries (and reports again).
    await expect(built.ctx.send("class_list", {})).rejects.toThrow(/cannot reach the Godot editor/);
    await built.client.close();
  });
});

describe("project-dir token resolution", () => {
  function projectWithTokenFile(token: string): string {
    const dir = mkdtempSync(join(tmpdir(), "godot-mcp-proj-"));
    mkdirSync(join(dir, ".godot"), { recursive: true });
    writeFileSync(join(dir, ".godot", "mcp-token.json"), JSON.stringify({ token }));
    return dir;
  }

  function authTokens(peer: StubPeer): string[] {
    return peer.inbound
      .filter((f) => f.command === "auth")
      .map((f) => (f.params as { token?: unknown }).token as string);
  }

  it("status-file token resolves from the configured projectDir (no env)", async () => {
    const dir = projectWithTokenFile("file-token-abc");
    const peer = gatedPeer();
    const built = buildServer({
      connectSocket: () => peer.connect(),
      projectDir: dir,
      env: {},
      log: caplog(),
    });
    await built.ctx.send("class_list", {});
    expect(authTokens(peer)[0]).toBe("file-token-abc");
    await built.client.close();
  });

  it("env still wins over the status file (order unchanged)", async () => {
    const dir = projectWithTokenFile("file-token-abc");
    const peer = gatedPeer();
    const built = buildServer({
      connectSocket: () => peer.connect(),
      projectDir: dir,
      env: { GODOT_MCP_TOKEN: "env-token" },
      log: caplog(),
    });
    await built.ctx.send("class_list", {});
    expect(authTokens(peer)[0]).toBe("env-token");
    await built.client.close();
  });
});
