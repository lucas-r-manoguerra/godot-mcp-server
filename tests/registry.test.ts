// Registry contract, partial (Task 2): custom-first lookup,
// DUPLICATE_TOOL throw, builtin unregister=false, undo gate, hints.
import { describe, expect, it } from "vitest";
import {
  DuplicateToolError,
  ToolRegistry,
  type ToolDef,
} from "../src/server/toolRegistry.js";

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
});
