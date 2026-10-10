// Meshes passthrough (spec 3.3, stratum C): verbatim re-exposure of the
// addon mesh_commands.gd set (validate_meshes, name verbatim from
// get_commands()). Mechanical schema: max_findings defaults to 25
// game-side, so it stays .optional(). Read-only integrity walk: no
// mutating flags. Sends go through ctx.send.

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
    name: "validate_meshes",
    description: "Walks ArrayMesh surfaces for silent corruption (optional max_findings cap).",
    inputSchema: {
      max_findings: z.number().int().optional(),
    },
    handler: passthrough("validate_meshes"),
    kind: "passthrough",
  },
];
