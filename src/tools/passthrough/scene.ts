// Scene passthrough (spec 3.3, stratum A): verbatim re-exposure of the
// addon scene_commands.gd set. Mechanical schemas: every field is an
// addon param with its addon name; requiredness mirrors the addon
// (scene_path is required by open_scene; the rest default server-side
// in the addon, so they stay optional here). All sends go through
// ctx.send; path params use the shared ScopedPath guard.

import { z } from "zod";
import { ScopedPathSchema } from "../../godot/scopedPath.js";
import type { ServerContext } from "../../server/buildServer.js";
import type { ToolDef } from "../../server/toolRegistry.js";

type Ctx = Pick<ServerContext, "send">;

function dropUndefined(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function passthrough(command: string) {
  return (args: Record<string, unknown>, ctx: unknown): Promise<unknown> => {
    const context = ctx as Ctx;
    return context.send(command, dropUndefined(args));
  };
}

export const toolDefs: ToolDef[] = [
  {
    name: "get_scene_tree",
    description: "Reads the edited scene tree (optional max_depth / max_children trims).",
    inputSchema: {
      max_depth: z.number().int().optional(),
      max_children: z.number().int().optional(),
    },
    handler: passthrough("get_scene_tree"),
    kind: "passthrough",
  },
  {
    name: "open_scene",
    description: "Opens a scene file in the editor.",
    inputSchema: {
      scene_path: ScopedPathSchema,
    },
    handler: passthrough("open_scene"),
    kind: "passthrough",
  },
  {
    name: "save_scene",
    description: "Saves the active scene (optional path for save-as of a never-saved scene).",
    inputSchema: {
      path: ScopedPathSchema.optional(),
    },
    handler: passthrough("save_scene"),
    kind: "passthrough",
  },
  {
    name: "reload_scene",
    description: "Reloads an already-open scene from disk; disk wins over unsaved edits.",
    inputSchema: {
      scene_path: ScopedPathSchema.optional(),
    },
    handler: passthrough("reload_scene"),
    kind: "passthrough",
  },
];
