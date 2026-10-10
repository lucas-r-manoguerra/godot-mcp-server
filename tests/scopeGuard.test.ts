// Task 1 (partial): 5-case matrix on the guard function alone.
// Task 10 (full, AC-09): the same matrix applied to every
// path-taking core tool (schema level — the shared inputSchema is the
// enforcement point the SDK validates before dispatch) plus
// handler-level asserts where the handler full-object-parses, plus one
// sample plugin tool inheriting the core guard.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { assertScopedPath, ScopedPathError, validate_scoped_path } from "../src/godot/scopedPath.js";
import { toolDefs as sceneDefs } from "../src/tools/passthrough/scene.js";
import { toolDefs as debugDefs } from "../src/tools/passthrough/debug.js";
import { toolDefs as screenshotDefs } from "../src/tools/passthrough/screenshots.js";
import { toolDefs as resources3dDefs } from "../src/tools/passthrough/resources3d.js";
import { toolDefs as nodeDefs } from "../src/tools/nodes.js";
import { toolDefs as assetDefs } from "../src/tools/assets.js";
import type { ToolDef } from "../src/server/toolRegistry.js";
import { ScopedPathSchema } from "../src/godot/scopedPath.js";

describe("validate_scoped_path matrix", () => {
  const cases: Array<[string, boolean]> = [
    ["res://scenes/main.tscn", true],
    ["user://saves/slot1.save", true],
    ["uid://b1x2y3z4", true],
    ["/abs/path.tscn", false],
    ["res://../escape.tscn", false],
  ];
  for (const [input, expected] of cases) {
    it(`${expected ? "allows" : "rejects"} ${input}`, () => {
      expect(validate_scoped_path(input)).toBe(expected);
    });
  }

  it("throwing variant names the offending value", () => {
    let caught: unknown = null;
    try {
      assertScopedPath("/abs/path.tscn");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ScopedPathError);
    const mcp = (caught as ScopedPathError).toMcp();
    expect(mcp.isError).toBe(true);
    expect(mcp._meta.code).toBe("INVALID_FORMAT");
    expect(mcp.content[0]?.text).toContain("/abs/path.tscn");
  });
});

// AC-09 (Task 10): the 5-case matrix applied to every path-taking
// core tool (spec 3.4 keys: scene_path, path, base, resource_path).
describe("scope guard across path-taking tools", () => {
  const matrix: Array<[string, boolean]> = [
    ["res://scenes/main.tscn", true],
    ["user://saves/slot1.save", true],
    ["uid://b1x2y3z4", true],
    ["/abs/path.tscn", false],
    ["res://../escape.tscn", false],
  ];

  function byName(defs: ToolDef[], name: string): ToolDef {
    const found = defs.find((tool) => tool.name === name);
    if (found === undefined) throw new Error(`missing toolDef "${name}"`);
    return found;
  }

  // Every core tool whose inputSchema carries a scoped-path param,
  // with the extra args its handler needs for a full call.
  const targets: Array<{
    def: ToolDef;
    pathKey: string;
    baseArgs: Record<string, unknown>;
    parsesInHandler: boolean;
  }> = [
    { def: byName(sceneDefs, "open_scene"), pathKey: "scene_path", baseArgs: {}, parsesInHandler: false },
    { def: byName(sceneDefs, "save_scene"), pathKey: "path", baseArgs: {}, parsesInHandler: false },
    { def: byName(sceneDefs, "reload_scene"), pathKey: "scene_path", baseArgs: {}, parsesInHandler: false },
    { def: byName(nodeDefs, "instantiate_scene"), pathKey: "scene_path", baseArgs: { parent_path: "/root/Main" }, parsesInHandler: true },
    { def: byName(debugDefs, "run_project"), pathKey: "scene_path", baseArgs: {}, parsesInHandler: false },
    { def: byName(resources3dDefs, "get_resource_info"), pathKey: "resource_path", baseArgs: {}, parsesInHandler: false },
    { def: byName(screenshotDefs, "capture_game_screenshot"), pathKey: "path", baseArgs: {}, parsesInHandler: false },
    { def: byName(screenshotDefs, "capture_editor_screenshot"), pathKey: "path", baseArgs: {}, parsesInHandler: false },
    { def: byName(assetDefs, "import_asset"), pathKey: "path", baseArgs: {}, parsesInHandler: true },
    { def: byName(assetDefs, "list_assets"), pathKey: "base", baseArgs: { glob: "**/*.png" }, parsesInHandler: true },
    {
      def: {
        name: "sample_plugin_tool",
        description: "Sample plugin tool inheriting the core scope guard.",
        inputSchema: { path: ScopedPathSchema },
        handler: (args: Record<string, unknown>, ctx: unknown) => {
          const parsed = z.object({ path: ScopedPathSchema }).parse(args);
          const context = ctx as {
            send: (c: string, p?: Record<string, unknown>) => Promise<unknown>;
          };
          return context.send("sample_plugin_tool", { ...parsed });
        },
        kind: "custom",
      },
      pathKey: "path",
      baseArgs: {},
      parsesInHandler: true,
    },
  ];

  for (const target of targets) {
    for (const [value, allowed] of matrix) {
      const verdict = allowed ? "allows" : "rejects";
      it(`${target.def.name}.${target.pathKey} ${verdict} ${value} (schema)`, () => {
        const schema = target.def.inputSchema[target.pathKey] as z.ZodTypeAny;
        if (allowed) {
          expect(() => schema.parse(value)).not.toThrow();
        } else {
          expect(() => schema.parse(value)).toThrow();
        }
      });
      if (target.parsesInHandler) {
        it(`${target.def.name}.${target.pathKey} ${verdict} ${value} (handler sends nothing when rejected)`, async () => {
          const send = vi.fn(() => Promise.resolve({ ok: true }));
          const args = { ...target.baseArgs, [target.pathKey]: value };
          if (allowed) {
            await target.def.handler(args, { send } as unknown);
            expect(send).toHaveBeenCalledOnce();
          } else {
            expect(() => target.def.handler(args, { send } as unknown)).toThrow();
            expect(send).not.toHaveBeenCalled();
          }
        });
      }
    }
  }
});
