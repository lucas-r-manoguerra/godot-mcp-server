// Introspection gap tools (spec 3.2, Task 8): read-only ClassDB
// surface. Schemas are transcribed verbatim from the spec; every send
// goes through ctx.send (no direct ws import). Budget: default.
// Unknown classes are an addon success envelope with
// result.found=false, never an exception — the handlers below pass
// results through untouched.

import { z } from "zod";
import type { ServerContext } from "../server/buildServer.js";
import type { ToolDef } from "../server/toolRegistry.js";

type Ctx = Pick<ServerContext, "send">;

function dropUndefined(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// Full-object parse so spec .default() values (limit, detail) apply
// before the frame is built; optional filters stay omitted via
// dropUndefined when absent.
const classListSchema = z.object({
  search: z.string().optional(),
  parent: z.string().optional(),
  limit: z.number().int().default(200),
});

const classDescribeSchema = z.object({
  class_name: z.string().min(1),
  detail: z.enum(["brief", "full"]).default("brief"),
});

const signalsOfSchema = z.object({
  class_name: z.string().min(1),
});

function gapRead(command: string, schema: z.ZodTypeAny) {
  return (args: Record<string, unknown>, ctx: unknown): Promise<unknown> => {
    const parsed = schema.parse(args) as Record<string, unknown>;
    const context = ctx as Ctx;
    return context.send(command, dropUndefined(parsed));
  };
}

export const toolDefs: ToolDef[] = [
  {
    name: "class_list",
    description: "Lists ClassDB classes, optionally filtered by search substring or parent class.",
    inputSchema: {
      search: z.string().optional(),
      parent: z.string().optional(),
      limit: z.number().int().default(200),
    },
    handler: gapRead("class_list", classListSchema),
    kind: "gap",
  },
  {
    name: "class_describe",
    description: "Describes one ClassDB class (unknown class returns found:false, never an exception).",
    inputSchema: {
      class_name: z.string().min(1),
      detail: z.enum(["brief", "full"]).default("brief"),
    },
    handler: gapRead("class_describe", classDescribeSchema),
    kind: "gap",
  },
  {
    name: "signals_of",
    description: "Lists the signals of one ClassDB class with their argument names.",
    inputSchema: {
      class_name: z.string().min(1),
    },
    handler: gapRead("signals_of", signalsOfSchema),
    kind: "gap",
  },
];
