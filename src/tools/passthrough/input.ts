// Input passthrough (spec 3.3, stratum B): verbatim re-exposure of the
// addon input_commands.gd set. execute_input_sequence and type_text
// run the extended (60 s) budget class per spec 5; get_input_map is
// budget-default. Addon rules enforced Zod-level before any frame is
// sent: inputs must be non-empty, text must be non-empty (the
// find_nodes at-least-one precedent from stratum A). All sends go
// through ctx.send (no direct ws import).

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
    name: "get_input_map",
    description: "Reads the project input map (live bridge when running, project settings otherwise).",
    inputSchema: {},
    handler: passthrough("get_input_map"),
    kind: "passthrough",
  },
  {
    name: "execute_input_sequence",
    description: "Injects a timed input sequence into the running game (extended 60 s budget).",
    inputSchema: {
      inputs: z.array(z.record(z.string(), z.unknown())).min(1),
      report: z.array(z.record(z.string(), z.unknown())).optional(),
      screenshot_at_ms: z.array(z.number()).optional(),
      screenshot_max_width: z.number().int().optional(),
    },
    handler: passthrough("execute_input_sequence"),
    kind: "passthrough",
    budgetClass: "extended",
  },
  {
    name: "type_text",
    description: "Types text into the running game (extended 60 s budget).",
    inputSchema: {
      text: z.string().min(1),
      delay_ms: z.number().int().optional(),
      submit: z.boolean().optional(),
    },
    handler: passthrough("type_text"),
    kind: "passthrough",
    budgetClass: "extended",
  },
];
