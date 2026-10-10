// Viewport gap tools (spec 3.2, Task 9): editor camera navigation.
// Non-mutating by rule, so UndoRedo is N/A (no undoAction, no
// mutating flag). Budget: default. All sends go through ctx.send.
// NEW addon surface: frames verbatim per spec, fixture-level tests;
// live editor behavior stays pending on the addon side.

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

const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

// Full-object parse (record-of-schemas never applies Zod defaults;
// no defaults here, but the T8 pattern keeps behavior uniform).
const set3dViewportSchema = z.object({
  position: vec3Schema,
  rotation: vec3Schema,
  distance: z.number().positive().optional(),
  focus_path: z.string().optional(),
});

const focusSelectionSchema = z.object({
  node_paths: z.array(z.string().min(1)).min(1).max(64),
});

function gapNav(command: string, schema: z.ZodTypeAny) {
  return (args: Record<string, unknown>, ctx: unknown): Promise<unknown> => {
    const parsed = schema.parse(args) as Record<string, unknown>;
    const context = ctx as Ctx;
    return context.send(command, dropUndefined(parsed));
  };
}

export const toolDefs: ToolDef[] = [
  {
    name: "set_3d_viewport",
    description: "Moves the 3D editor camera (navigation, not undoable).",
    inputSchema: {
      position: vec3Schema,
      rotation: vec3Schema,
      distance: z.number().positive().optional(),
      focus_path: z.string().optional(),
    },
    handler: gapNav("set_3d_viewport", set3dViewportSchema),
    kind: "gap",
  },
  {
    name: "focus_selection",
    description: "Frames 1..64 nodes in the editor viewport (navigation, not undoable).",
    inputSchema: {
      node_paths: z.array(z.string().min(1)).min(1).max(64),
    },
    handler: gapNav("focus_selection", focusSelectionSchema),
    kind: "gap",
  },
];
