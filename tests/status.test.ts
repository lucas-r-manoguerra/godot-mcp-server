// server_status suite (Task 10, design Q2): tool shape plus the
// protocol-drift flag wiring from negotiation to the tool surface.
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server/buildServer.js";
import {
  defaultStatusRecord,
  registerServerStatusTool,
  SERVER_STATUS_DESCRIPTION,
  SERVER_STATUS_TOOL,
} from "../src/server/serverStatus.js";
import { SERVER_NAME, SERVER_VERSION } from "../src/version.js";

describe("server_status shape", () => {
  it("uses the design Q2 tool name", () => {
    expect(SERVER_STATUS_TOOL).toBe("server_status");
  });

  it("default record carries the full Q2 shape with no drift", () => {
    expect(defaultStatusRecord()).toEqual({
      mode: "auth",
      addon_version: "unknown",
      godot_version: "unknown",
      project_path: "",
      project_name: "",
      server_version: `${SERVER_NAME}/${SERVER_VERSION}`,
      protocol_drift_suspected: false,
    });
  });

  it("carries a human-readable description", () => {
    expect(SERVER_STATUS_DESCRIPTION.length).toBeGreaterThan(0);
  });
});

describe("server_status drift-flag wiring", () => {
  it("buildServer seeds capabilities from options; drift propagates to the tool", async () => {
    const { ctx } = buildServer({
      mode: "no-auth-full",
      projectRoot: "/tmp/demo",
      projectName: "demo",
    });
    expect(ctx.capabilities.mode).toBe("no-auth-full");
    expect(ctx.capabilities.project_path).toBe("/tmp/demo");
    expect(ctx.capabilities.project_name).toBe("demo");

    const seen: Array<{
      name: string;
      handler: () => Promise<unknown>;
    }> = [];
    const fake = {
      registerTool: (
        name: string,
        _config: unknown,
        handler: () => Promise<unknown>,
      ): void => {
        seen.push({ name, handler });
      },
    };
    // Negotiation (handshake/verify) flips this flag; the tool must
    // surface the live record, not a snapshot.
    ctx.capabilities.protocol_drift_suspected = true;
    registerServerStatusTool(fake as never, () => ctx.capabilities);
    expect(seen.length).toBe(1);
    expect(seen[0]?.name).toBe("server_status");
    const handler = seen[0]?.handler;
    if (handler === undefined) throw new Error("server_status handler not registered");
    const out = (await handler()) as {
      content: Array<{ type: string; text: string }>;
    };
    const record = JSON.parse(out.content[0]?.text ?? "{}") as {
      mode: string;
      protocol_drift_suspected: boolean;
      server_version: string;
    };
    expect(record.mode).toBe("no-auth-full");
    expect(record.protocol_drift_suspected).toBe(true);
    expect(record.server_version).toBe(`${SERVER_NAME}/${SERVER_VERSION}`);
  });
});
