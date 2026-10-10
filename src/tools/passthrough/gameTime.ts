// Game-time passthrough (spec 3.3, stratum C): verbatim re-exposure of
// the addon game_time_commands.gd set (5 commands, names verbatim from
// get_commands()). Mechanical schemas: only game_time_step_until requires
// a param (non-empty until per the bridge); everything else defaults
// server-side and stays .optional(). Deterministic time control for the
// running game; no editor undo applies. All sends go through ctx.send.

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

const stepInput = z.array(z.record(z.string(), z.unknown())).optional();
const stepReport = z.array(z.record(z.string(), z.unknown())).optional();

export const toolDefs: ToolDef[] = [
  {
    name: "game_time_freeze",
    description: "Freezes game time in the running game.",
    inputSchema: {},
    handler: passthrough("game_time_freeze"),
    kind: "passthrough",
  },
  {
    name: "game_time_step",
    description: "Advances frozen game time by duration_ms or frames (one is required by the bridge; optional inputs/report).",
    inputSchema: {
      duration_ms: z.number().int().optional(),
      frames: z.number().int().optional(),
      inputs: stepInput,
      report: stepReport,
    },
    handler: passthrough("game_time_step"),
    kind: "passthrough",
  },
  {
    name: "game_time_step_until",
    description: "Advances frozen game time until a predicate holds (optional max_ms/inputs/report).",
    inputSchema: {
      until: z.string().min(1),
      max_ms: z.number().int().optional(),
      inputs: stepInput,
      report: stepReport,
    },
    handler: passthrough("game_time_step_until"),
    kind: "passthrough",
  },
  {
    name: "game_time_thaw",
    description: "Resumes normal game time in the running game.",
    inputSchema: {},
    handler: passthrough("game_time_thaw"),
    kind: "passthrough",
  },
  {
    name: "game_time_status",
    description: "Reads the frozen/step state of game time.",
    inputSchema: {},
    handler: passthrough("game_time_status"),
    kind: "passthrough",
  },
];
