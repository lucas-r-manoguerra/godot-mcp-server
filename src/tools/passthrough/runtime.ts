// Runtime passthrough (spec 3.3, stratum C): verbatim re-exposure of
// the addon runtime_state_commands.gd set (4 commands, names verbatim
// from get_commands()). Mechanical schemas: every field is an addon or
// bridge param with its addon name; all default server-side, so all stay
// .optional(). Read-only sampling surface: no mutating flags. All sends
// go through ctx.send.

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
    name: "get_runtime_state",
    description: "Samples live node state from the running game (optional select/group/name/type/max_nodes/include/paths filters).",
    inputSchema: {
      select: z.string().optional(),
      group: z.string().optional(),
      name: z.string().optional(),
      type: z.string().optional(),
      max_nodes: z.number().int().optional(),
      include: z.array(z.string()).optional(),
      paths: z.array(z.string()).optional(),
    },
    handler: passthrough("get_runtime_state"),
    kind: "passthrough",
  },
  {
    name: "watch_start",
    description: "Starts a watch stream over specs at a sample rate (optional specs/hz/duration_ms/signals).",
    inputSchema: {
      specs: z.array(z.record(z.string(), z.unknown())).optional(),
      hz: z.number().int().optional(),
      duration_ms: z.number().int().optional(),
      signals: z.array(z.string()).optional(),
    },
    handler: passthrough("watch_start"),
    kind: "passthrough",
  },
  {
    name: "watch_collect",
    description: "Collects the buffered watch stream samples.",
    inputSchema: {},
    handler: passthrough("watch_collect"),
    kind: "passthrough",
  },
  {
    name: "watch_stop",
    description: "Stops the active watch stream.",
    inputSchema: {},
    handler: passthrough("watch_stop"),
    kind: "passthrough",
  },
];
