// Registry contract, partial (Task 2): custom-first lookup,
// DUPLICATE_TOOL throw, builtin unregister=false, undo gate, hints.
import { describe, expect, it } from "vitest";
import {
  DuplicateToolError,
  ToolRegistry,
  type ToolDef,
} from "../src/server/toolRegistry.js";
import { toolDefs as animationDefs } from "../src/tools/passthrough/animation.js";
import { toolDefs as tileDefs } from "../src/tools/passthrough/tiles.js";
import { toolDefs as profilerDefs } from "../src/tools/passthrough/profiler.js";
import { toolDefs as runtimeDefs } from "../src/tools/passthrough/runtime.js";
import { toolDefs as gameTimeDefs } from "../src/tools/passthrough/gameTime.js";
import { toolDefs as execDefs } from "../src/tools/passthrough/exec.js";
import { toolDefs as meshesDefs } from "../src/tools/passthrough/meshes.js";
import { EXEC_DESCRIPTION_FENCE } from "../src/server/toolRegistry.js";

function def(name: string, kind: ToolDef["kind"] = "custom", extra: Partial<ToolDef> = {}): ToolDef {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {},
    handler: () => Promise.resolve({ ok: true }),
    kind,
    ...extra,
  };
}

describe("tool registry", () => {
  it("resolves custom-first over gap/passthrough/builtin", () => {
    const registry = new ToolRegistry();
    registry.register_tool(def("mine", "custom"));
    registry.register_tool(def("core", "builtin"));
    registry.register_tool(def("mid", "gap"));
    registry.register_tool(def("pass", "passthrough"));
    // resolve() consults the custom map before gap, passthrough, builtin.
    expect(registry.resolve("mine")?.kind).toBe("custom");
    expect(registry.resolve("mid")?.kind).toBe("gap");
    expect(registry.resolve("pass")?.kind).toBe("passthrough");
    expect(registry.resolve("core")?.kind).toBe("builtin");
    expect(registry.resolve("missing")).toBeUndefined();
    // No stratum may shadow an existing name, in either direction.
    expect(() => registry.register_tool(def("mine", "builtin"))).toThrowError("DUPLICATE_TOOL");
  });

  it("register_tool with a builtin name throws DUPLICATE_TOOL", () => {
    const registry = new ToolRegistry();
    registry.register_tool(def("core_thing", "builtin"));
    const attempt = () => registry.register_tool(def("core_thing", "custom"));
    expect(attempt).toThrowError(DuplicateToolError);
    expect(attempt).toThrowError("DUPLICATE_TOOL");
  });

  it("unregister_tool removes custom-only; builtins never (false)", () => {
    const registry = new ToolRegistry();
    registry.register_tool(def("core_thing", "builtin"));
    registry.register_tool(def("mine", "custom"));
    expect(registry.unregister_tool("core_thing")).toBe(false);
    expect(registry.unregister_tool("absent")).toBe(false);
    expect(registry.unregister_tool("mine")).toBe(true);
    expect(registry.resolve("mine")).toBeUndefined();
    // A freed custom name may re-register without DUPLICATE_TOOL.
    expect(() => registry.register_tool(def("mine", "custom"))).not.toThrow();
  });

  it("mutating gap tools without undoAction fail registration", () => {
    const registry = new ToolRegistry();
    expect(() => registry.register_tool(def("grow", "gap", { mutating: true }))).toThrowError(
      /undoAction/,
    );
    expect(() =>
      registry.register_tool(def("grow", "gap", { mutating: true, undoAction: "Grow" })),
    ).not.toThrow();
    // Null marks the explicit v0.1.0 exemption (tile/animation writes).
    expect(() =>
      registry.register_tool(def("paint", "passthrough", { mutating: true, undoAction: null })),
    ).not.toThrow();
  });

  it("UNKNOWN_COMMAND carries Levenshtein hints", () => {
    const registry = new ToolRegistry();
    registry.register_tool(def("server_status", "builtin"));
    const err = registry.unknownCommand("server_stats");
    expect(err._meta.code).toBe("UNKNOWN_COMMAND");
    expect(err._meta.hint).toContain("server_status");
  });

  it("stratum C tile/animation defs register; writes carry undoAction null", () => {
    // 16 animation + 11 TileMapLayer + 10 GridMap/MeshLibrary, verbatim
    // from the addon get_commands() blocks.
    expect(animationDefs.length).toBe(16);
    expect(tileDefs.length).toBe(21);
    const registry = new ToolRegistry();
    for (const tool of [...animationDefs, ...tileDefs]) {
      expect(() => registry.register_tool(tool)).not.toThrow();
      expect(registry.resolve(tool.name)?.kind).toBe("passthrough");
    }
    // Spec 3.3 / AC-07: tile/animation writes keep addon behavior with
    // no new undo promise — the null marks the explicit v0.1.0 exemption.
    const writes = [...animationDefs, ...tileDefs].filter((tool) => tool.mutating === true);
    expect(writes.length).toBe(9 + 8);
    for (const tool of writes) {
      expect(tool.undoAction).toBeNull();
    }
  });

  it("stratum C remainder defs register; exec descriptions carry the fence", () => {
    // Profiler 6 + runtime 4 + game-time 5 + exec 4 + meshes 1, verbatim
    // from the addon get_commands() blocks.
    expect(profilerDefs.length).toBe(6);
    expect(runtimeDefs.length).toBe(4);
    expect(gameTimeDefs.length).toBe(5);
    expect(execDefs.length).toBe(4);
    expect(meshesDefs.length).toBe(1);
    const registry = new ToolRegistry();
    for (const tool of [...profilerDefs, ...runtimeDefs, ...gameTimeDefs, ...execDefs, ...meshesDefs]) {
      expect(() => registry.register_tool(tool)).not.toThrow();
      expect(registry.resolve(tool.name)?.kind).toBe("passthrough");
    }
    // Spec 3.3 fence (proposal risk 5): every exec description names the
    // escape hatch and points at typed tools.
    for (const tool of execDefs) {
      expect(tool.description).toContain(EXEC_DESCRIPTION_FENCE);
    }
  });
});
