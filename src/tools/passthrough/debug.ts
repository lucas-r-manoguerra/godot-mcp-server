// Debug passthrough (spec 3.3, stratum B): verbatim re-exposure of the
// addon debug_commands.gd set. Mechanical schemas: every field is an
// addon param with its addon name; requiredness mirrors the addon
// (run_project with no scene_path plays the main scene; every other
// param defaults server-side in the addon, so all stay optional).
// All sends go through ctx.send; scene_path uses the shared
// ScopedPath guard.

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
    name: "run_project",
    description: "Runs the project in the editor (optional scene_path override, optional frozen launch).",
    inputSchema: {
      scene_path: ScopedPathSchema.optional(),
      frozen: z.boolean().optional(),
    },
    handler: passthrough("run_project"),
    kind: "passthrough",
  },
  {
    name: "stop_project",
    description: "Stops the running project.",
    inputSchema: {},
    handler: passthrough("stop_project"),
    kind: "passthrough",
  },
  {
    name: "get_log_messages",
    description: "Reads buffered log messages (optional clear / limit / severity / since filters).",
    inputSchema: {
      clear: z.boolean().optional(),
      limit: z.number().int().optional(),
      severity: z.string().optional(),
      since: z.number().int().optional(),
    },
    handler: passthrough("get_log_messages"),
    kind: "passthrough",
  },
  {
    name: "get_stack_trace",
    description: "Reads the last error and its stack frames.",
    inputSchema: {},
    handler: passthrough("get_stack_trace"),
    kind: "passthrough",
  },
];
