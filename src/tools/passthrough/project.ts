// Project passthrough (spec 3.3, stratum A): verbatim re-exposure of
// the addon project_commands.gd set. All three tools take no required
// params; category / include_builtin mirror the addon's optional
// filters. All sends go through ctx.send.

import { z } from "zod";
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
    name: "get_project_info",
    description: "Reads the project identity (name, path, Godot version, main scene).",
    inputSchema: {},
    handler: passthrough("get_project_info"),
    kind: "passthrough",
  },
  {
    name: "get_project_settings",
    description: "Reads project settings, optionally filtered by category prefix.",
    inputSchema: {
      category: z.string().optional(),
      include_builtin: z.boolean().optional(),
    },
    handler: passthrough("get_project_settings"),
    kind: "passthrough",
  },
  {
    name: "get_project_staleness",
    description: "Reports whether project.godot changed on disk after the editor loaded it.",
    inputSchema: {},
    handler: passthrough("get_project_staleness"),
    kind: "passthrough",
  },
];
