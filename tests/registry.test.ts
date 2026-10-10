// Registry contract, partial (Task 2): custom-first lookup,
// DUPLICATE_TOOL throw, builtin unregister=false, undo gate, hints.
import { describe, expect, it, vi } from "vitest";
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
import { toolDefs as introspectionDefs } from "../src/tools/introspection.js";
import { toolDefs as nodeDefs } from "../src/tools/nodes.js";
import { toolDefs as signalDefs } from "../src/tools/signals.js";
import { toolDefs as viewportDefs } from "../src/tools/viewport.js";
import { toolDefs as assetDefs } from "../src/tools/assets.js";
import { toolDefs as verifyDefs } from "../src/tools/verify.js";
import { EXEC_DESCRIPTION_FENCE } from "../src/server/toolRegistry.js";
import { z } from "zod";
import {
  PluginHotLoader,
  PluginStartupError,
  isGameContentName,
  loadStartupPlugins,
  type PluginModuleImporter,
} from "../src/server/pluginLoader.js";
import { ScopedPathSchema } from "../src/godot/scopedPath.js";

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

  it("gap tools A register: 3 introspection reads + 4 node-lifecycle writes", () => {
    // Spec 3.2 first half: class_list, class_describe, signals_of |
    // create_node, instantiate_scene, duplicate_node, delete_node.
    expect(introspectionDefs.map((tool) => tool.name)).toEqual([
      "class_list",
      "class_describe",
      "signals_of",
    ]);
    expect(nodeDefs.map((tool) => tool.name)).toEqual([
      "create_node",
      "instantiate_scene",
      "duplicate_node",
      "delete_node",
    ]);
    const registry = new ToolRegistry();
    for (const tool of [...introspectionDefs, ...nodeDefs]) {
      expect(() => registry.register_tool(tool)).not.toThrow();
      expect(registry.resolve(tool.name)?.kind).toBe("gap");
    }
  });

  it("every mutating gap tool A def carries its verbatim undoAction", () => {
    // Spec 3.2 / AC-07 named actions; the registry gate already rejects
    // mutating gap defs without undoAction — here the exact strings.
    const expected: Record<string, string> = {
      create_node: "Create <Class> <name>",
      instantiate_scene: "Instantiate <scene_file>",
      duplicate_node: "Duplicate <name>",
      delete_node: "Delete <name>",
    };
    for (const tool of nodeDefs) {
      expect(tool.mutating).toBe(true);
      expect(tool.undoAction).toBe(expected[tool.name]);
    }
    // Read-only introspection tools promise no undo action.
    for (const tool of introspectionDefs) {
      expect(tool.mutating ?? false).toBe(false);
      expect(tool.undoAction).toBeUndefined();
    }
  });

  it("delete_node confirm_name mismatch sends nothing (Zod-level guard)", () => {
    const found = nodeDefs.find((tool) => tool.name === "delete_node");
    if (found === undefined) throw new Error('missing toolDef "delete_node"');
    const send = vi.fn(() => Promise.resolve({ ok: true }));
    expect(() =>
      found.handler(
        { node_path: "/root/Main/Enemy", confirm_name: "Player" },
        { send } as unknown,
      ),
    ).toThrowError(/confirm_name/);
    expect(send).not.toHaveBeenCalled();
  });

  it("delete_node matching confirm_name sends one frame", async () => {
    const found = nodeDefs.find((tool) => tool.name === "delete_node");
    if (found === undefined) throw new Error('missing toolDef "delete_node"');
    const send = vi.fn(() => Promise.resolve({ deleted: true }));
    await found.handler(
      { node_path: "/root/Main/Enemy", confirm_name: "Enemy" },
      { send } as unknown,
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("delete_node");
    expect(send.mock.calls[0]?.[1]).toEqual({
      node_path: "/root/Main/Enemy",
      confirm_name: "Enemy",
    });
  });

  it("class_list and class_describe apply their spec defaults", async () => {
    const list = introspectionDefs.find((tool) => tool.name === "class_list");
    const describe = introspectionDefs.find((tool) => tool.name === "class_describe");
    if (list === undefined || describe === undefined) throw new Error("missing introspection defs");
    const listSend = vi.fn(() => Promise.resolve({ classes: [] }));
    await list.handler({ parent: "Node" }, { send: listSend } as unknown);
    expect(listSend.mock.calls[0]?.[1]).toEqual({ parent: "Node", limit: 200 });
    const describeSend = vi.fn(() => Promise.resolve({ found: false }));
    await describe.handler({ class_name: "Nope" }, { send: describeSend } as unknown);
    expect(describeSend.mock.calls[0]?.[1]).toEqual({ class_name: "Nope", detail: "brief" });
  });

  it("gap tools B register: 3 signals + 2 viewport + 3 assets + verify", () => {
    // Spec 3.2 second half: connect/disconnect/trace | set_3d_viewport,
    // focus_selection | import_asset, uid_resolve, list_assets | verify.
    expect(signalDefs.map((tool) => tool.name)).toEqual([
      "connect_signal",
      "disconnect_signal",
      "trace_signal",
    ]);
    expect(viewportDefs.map((tool) => tool.name)).toEqual([
      "set_3d_viewport",
      "focus_selection",
    ]);
    expect(assetDefs.map((tool) => tool.name)).toEqual([
      "import_asset",
      "uid_resolve",
      "list_assets",
    ]);
    expect(verifyDefs.map((tool) => tool.name)).toEqual(["verify"]);
    const registry = new ToolRegistry();
    for (const tool of [...signalDefs, ...viewportDefs, ...assetDefs, ...verifyDefs]) {
      expect(() => registry.register_tool(tool)).not.toThrow();
      expect(registry.resolve(tool.name)?.kind).toBe("gap");
    }
  });

  it("signal connect/disconnect carry verbatim undoActions; trace is extended read-only", () => {
    const expected: Record<string, string> = {
      connect_signal: "Connect <signal> → <method>",
      disconnect_signal: "Disconnect <signal> → <method>",
    };
    for (const tool of signalDefs) {
      if (tool.name === "trace_signal") {
        expect(tool.mutating ?? false).toBe(false);
        expect(tool.undoAction).toBeUndefined();
        expect(tool.budgetClass).toBe("extended");
      } else {
        expect(tool.mutating).toBe(true);
        expect(tool.undoAction).toBe(expected[tool.name]);
      }
    }
    // Viewport navigation and assets: Undo N/A by rule; verify extended.
    for (const tool of [...viewportDefs, ...assetDefs]) {
      expect(tool.mutating ?? false).toBe(false);
      expect(tool.undoAction).toBeUndefined();
    }
    expect(verifyDefs[0]?.budgetClass).toBe("extended");
  });

  it("gap tools B apply their spec defaults before send", async () => {
    const connect = signalDefs.find((tool) => tool.name === "connect_signal");
    const trace = signalDefs.find((tool) => tool.name === "trace_signal");
    const importAsset = assetDefs.find((tool) => tool.name === "import_asset");
    const list = assetDefs.find((tool) => tool.name === "list_assets");
    if (connect === undefined || trace === undefined) throw new Error("missing signal defs");
    if (importAsset === undefined || list === undefined) throw new Error("missing asset defs");
    const connectSend = vi.fn(() => Promise.resolve({ connected: true }));
    await connect.handler(
      { node_path: "/root/A", signal: "s", target_path: "/root/B", method: "m" },
      { send: connectSend } as unknown,
    );
    expect(connectSend.mock.calls[0]?.[1]).toMatchObject({ binds: [] });
    const importSend = vi.fn(() => Promise.resolve({ status: "imported" }));
    await importAsset.handler({ path: "res://icon.svg" }, { send: importSend } as unknown);
    expect(importSend.mock.calls[0]?.[1]).toEqual({ path: "res://icon.svg", reimport: false });
    const listSend = vi.fn(() => Promise.resolve({ paths: [] }));
    await list.handler({ glob: "**/*.png" }, { send: listSend } as unknown);
    expect(listSend.mock.calls[0]?.[1]).toEqual({ glob: "**/*.png", limit: 200 });
  });
});

// Plugin loader (Task 10, spec 4): startup abort naming the offender,
// hot-load per-file isolation, and the unload/reload cycle through the
// sole non-test unregister_tool caller. Confinement failures point at
// specs section 4.
describe("plugin loader", () => {
  function pluginDef(name: string, extra: Partial<ToolDef> = {}): ToolDef {
    return {
      name,
      description: `${name} plugin tool`,
      inputSchema: {},
      handler: () => Promise.resolve({ ok: true }),
      kind: "custom",
      ...extra,
    };
  }

  function stubImporter(modules: Record<string, unknown>): PluginModuleImporter {
    return (specifier: string): Promise<unknown> => {
      if (!Object.hasOwn(modules, specifier)) {
        return Promise.reject(new Error(`MODULE_NOT_FOUND: ${specifier}`));
      }
      return Promise.resolve(modules[specifier]);
    };
  }

  it("startup load aborts naming the offender (DUPLICATE_TOOL fail-fast)", async () => {
    const registry = new ToolRegistry();
    registry.register_tool(def("server_status", "builtin"));
    const importer = stubImporter({
      "./good.ts": { toolDefs: [pluginDef("good_tool")] },
      "./bad.ts": { toolDefs: [pluginDef("server_status")] },
    });
    const attempt = loadStartupPlugins({
      registry,
      plugins: ["./good.ts", "./bad.ts"],
      importer,
    });
    await expect(attempt).rejects.toThrow(PluginStartupError);
    await expect(attempt).rejects.toThrow("./bad.ts");
    await expect(attempt).rejects.toThrow("DUPLICATE_TOOL");
    // The offender path is carried structurally, not just in text.
    await attempt.catch((err: unknown) => {
      expect((err as PluginStartupError).pluginPath).toBe("./bad.ts");
    });
  });

  it("startup load aborts on a missing module, naming it", async () => {
    const registry = new ToolRegistry();
    const attempt = loadStartupPlugins({
      registry,
      plugins: ["./missing.ts"],
      importer: stubImporter({}),
    });
    await expect(attempt).rejects.toThrow("./missing.ts");
  });

  it("hot-load isolates per-file failures (log + skip, server stays up)", async () => {
    const registry = new ToolRegistry();
    const importer = stubImporter({
      "./good.ts": { toolDefs: [pluginDef("hot_good")] },
    });
    const loader = new PluginHotLoader(registry, importer);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await loader.loadFiles(["./good.ts", "./broken.ts"]);
      expect(result.loaded).toEqual(["hot_good"]);
      expect(result.skipped.length).toBe(1);
      expect(result.skipped[0]?.file).toBe("./broken.ts");
      expect(registry.resolve("hot_good")?.kind).toBe("custom");
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("unload/reload frees names for re-registration; in-flight calls complete", async () => {
    const registry = new ToolRegistry();
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const importer = stubImporter({
      "./cyclic.ts": {
        toolDefs: [pluginDef("cyclic_tool", { handler: () => gate })],
      },
    });
    const loader = new PluginHotLoader(registry, importer);
    await loader.loadFile("./cyclic.ts");
    const send = vi.fn(() => Promise.resolve({ ok: true }));
    const inFlight = registry.resolve("cyclic_tool")?.handler({}, { send });
    if (inFlight === undefined) throw new Error("cyclic_tool did not load");
    // Unload mid-flight: the map entry drops (sole non-test
    // unregister_tool caller) while the running handler is untouched.
    expect(await loader.unloadFile("./cyclic.ts")).toBe(true);
    expect(registry.resolve("cyclic_tool")).toBeUndefined();
    release({ done: true });
    await expect(inFlight).resolves.toEqual({ done: true });
    // The freed name re-registers without DUPLICATE_TOOL.
    await expect(loader.loadFile("./cyclic.ts")).resolves.toEqual(["cyclic_tool"]);
    expect(registry.resolve("cyclic_tool")?.kind).toBe("custom");
    expect(await loader.unloadFile("./never-loaded.ts")).toBe(false);
  });

  it("plugin defs always land as custom; game-content pilots stay project-side", async () => {
    const registry = new ToolRegistry();
    const importer = stubImporter({
      "./pilot.ts": {
        toolDefs: [
          pluginDef("infinity_mu_scout", { kind: "builtin" as ToolDef["kind"] }),
        ],
      },
    });
    await loadStartupPlugins({ registry, plugins: ["./pilot.ts"], importer });
    // Closed core: even a builtin-kind declaration lands in custom.
    expect(registry.resolve("infinity_mu_scout")?.kind).toBe("custom");
    expect(isGameContentName("infinity_mu_scout")).toBe(true);
    expect(isGameContentName("class_list")).toBe(false);
    // Custom-map membership proof: unregister (custom-only) succeeds.
    expect(registry.unregister_tool("infinity_mu_scout")).toBe(true);
  });

  it("confined handlers reject transport/sync-IO/listeners, citing specs section 4", async () => {
    const cases: Array<[string, ToolDef["handler"]]> = [
      ["raw WebSocket", () => {
        void "new WebSocket()";
        return Promise.resolve(null);
      }],
      ["blocking sync I/O", () => Promise.resolve(typeof execSync)],
      ["network listener", () => {
        void "server.listen(0)";
        return Promise.resolve(null);
      }],
    ];
    for (const [label, handler] of cases) {
      const registry = new ToolRegistry();
      const importer = stubImporter({
        "./wild.ts": { toolDefs: [pluginDef("wild_tool", { handler })] },
      });
      const attempt = loadStartupPlugins({
        registry,
        plugins: ["./wild.ts"],
        importer,
      });
      await expect(attempt, label).rejects.toThrow(/specs\.md section 4/);
      expect(registry.resolve("wild_tool"), label).toBeUndefined();
    }
  });

  it("sample plugin tool honours the shared scope guard", async () => {
    const registry = new ToolRegistry();
    const importer = stubImporter({
      "./sample.ts": {
        toolDefs: [
          {
            name: "sample_plugin_echo",
            description: "Sample plugin tool honouring the shared scope guard.",
            inputSchema: { path: ScopedPathSchema },
            handler: (args: Record<string, unknown>, ctx: unknown) => {
              const parsed = z.object({ path: ScopedPathSchema }).parse(args);
              const context = ctx as {
                send: (c: string, p?: Record<string, unknown>) => Promise<unknown>;
              };
              return context.send("sample_plugin_echo", { ...parsed });
            },
            kind: "custom",
          },
        ],
      },
    });
    await loadStartupPlugins({ registry, plugins: ["./sample.ts"], importer });
    const found = registry.resolve("sample_plugin_echo");
    if (found === undefined) throw new Error("sample plugin tool did not load");
    const send = vi.fn(() => Promise.resolve({ echoed: true }));
    await found.handler({ path: "res://mods/sample.cfg" }, { send } as unknown);
    expect(send).toHaveBeenCalledOnce();
    expect(() =>
      found.handler({ path: "/abs/escape.cfg" }, { send } as unknown),
    ).toThrow();
  });
});
