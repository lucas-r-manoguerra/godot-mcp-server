// Profiler passthrough (spec 3.3, stratum C): verbatim re-exposure of
// the addon profiler_commands.gd set (6 commands, names verbatim from
// get_commands()). Mechanical schemas: the addon takes no params except
// get_signal_connections' optional node_path filter, so every other def
// carries an empty schema. Read-only surface: no mutating flags. All
// sends go through ctx.send.

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
    name: "get_performance_metrics",
    description: "Reads live performance metrics from the running game debug session.",
    inputSchema: {},
    handler: passthrough("get_performance_metrics"),
    kind: "passthrough",
  },
  {
    name: "start_profiler",
    description: "Starts the frame profiler on the running game.",
    inputSchema: {},
    handler: passthrough("start_profiler"),
    kind: "passthrough",
  },
  {
    name: "stop_profiler",
    description: "Stops the frame profiler on the running game.",
    inputSchema: {},
    handler: passthrough("stop_profiler"),
    kind: "passthrough",
  },
  {
    name: "get_profiler_data",
    description: "Reads the collected frame profiler data.",
    inputSchema: {},
    handler: passthrough("get_profiler_data"),
    kind: "passthrough",
  },
  {
    name: "get_active_processes",
    description: "Lists the processes active in the running game.",
    inputSchema: {},
    handler: passthrough("get_active_processes"),
    kind: "passthrough",
  },
  {
    name: "get_signal_connections",
    description: "Reads signal connections (optional node_path filter).",
    inputSchema: {
      node_path: z.string().optional(),
    },
    handler: passthrough("get_signal_connections"),
    kind: "passthrough",
  },
];
