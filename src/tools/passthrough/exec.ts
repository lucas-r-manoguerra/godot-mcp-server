// Exec passthrough (spec 3.3, stratum C): verbatim re-exposure of the
// addon exec_commands.gd set (4 commands, names verbatim from
// get_commands()). Every description carries the spec fence "escape
// hatch, prefer typed tools" (proposal risk 5): GDScript eval in the
// game is synchronous and non-preemptible by design. Mechanical schemas:
// source and name are required (the bridge rejects empty sources with
// NO_CODE); list/clear take no params. All sends go through ctx.send.

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
    name: "exec_run",
    description: "Runs GDScript source in the game (escape hatch, prefer typed tools).",
    inputSchema: {
      source: z.string().min(1),
    },
    handler: passthrough("exec_run"),
    kind: "passthrough",
  },
  {
    name: "exec_list",
    description: "Lists live exec holder nodes (escape hatch, prefer typed tools).",
    inputSchema: {},
    handler: passthrough("exec_list"),
    kind: "passthrough",
  },
  {
    name: "exec_remove",
    description: "Removes one exec holder node by exact name (escape hatch, prefer typed tools).",
    inputSchema: {
      name: z.string().min(1),
    },
    handler: passthrough("exec_remove"),
    kind: "passthrough",
  },
  {
    name: "exec_clear",
    description: "Removes every exec holder node (escape hatch, prefer typed tools).",
    inputSchema: {},
    handler: passthrough("exec_clear"),
    kind: "passthrough",
  },
];
