// Regression: buildServer() must wire EVERY tool module (gap +
// passthrough + verify), not just server_status. On main the factory
// registered 1 tool, so tools/list exposed only server_status while
// unit tests (importing toolDefs directly) stayed green.
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server/buildServer.js";

// Nominal sample spanning every module family.
const SAMPLE = [
  "server_status",
  "class_list",
  "create_node",
  "connect_signal",
  "set_3d_viewport",
  "import_asset",
  "verify",
  "get_scene_tree",
  "exec_run",
] as const;

function mcpToolNames(built: ReturnType<typeof buildServer>): string[] {
  const server = built.server as unknown as {
    _registeredTools?: Record<string, unknown>;
  };
  return Object.keys(server._registeredTools ?? {});
}

describe("buildServer wires all tool modules", () => {
  it("registers the full toolset (registry + McpServer)", () => {
    const built = buildServer();
    const registryNames = built.registry.names();
    // 100 module defs + server_status = 101. Floor at 100 so additive
    // growth never breaks the gate; the sample pins exact wiring.
    expect(registryNames.length).toBeGreaterThanOrEqual(100);
    for (const name of SAMPLE) {
      expect(registryNames).toContain(name);
      expect(built.registry.resolve(name)).toBeDefined();
    }
    // The McpServer surface (what tools/list serves) must match the
    // registry: a registry-only fix would still serve 1 tool over stdio.
    const mcpNames = mcpToolNames(built);
    expect(mcpNames.length).toBeGreaterThanOrEqual(100);
    for (const name of SAMPLE) {
      expect(mcpNames).toContain(name);
    }
  });
});
