// Selection passthrough (spec 3.3, stratum A): verbatim re-exposure of
// the addon selection_commands.gd set. set_2d_viewport is editor
// navigation (undo N/A by rule). All sends go through ctx.send.

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
    name: "get_editor_state",
    description: "Reads the editor state (current scene, play mode, open scenes, viewport).",
    inputSchema: {},
    handler: passthrough("get_editor_state"),
    kind: "passthrough",
  },
  {
    name: "get_selected_nodes",
    description: "Lists the currently selected nodes.",
    inputSchema: {},
    handler: passthrough("get_selected_nodes"),
    kind: "passthrough",
  },
  {
    name: "select_node",
    description: "Clears the selection and selects one node.",
    inputSchema: {
      node_path: z.string().min(1),
    },
    handler: passthrough("select_node"),
    kind: "passthrough",
  },
  {
    name: "set_2d_viewport",
    description: "Moves the 2D editor viewport (navigation, undo N/A; omitted fields keep current view).",
    inputSchema: {
      center_x: z.number().optional(),
      center_y: z.number().optional(),
      zoom: z.number().positive().optional(),
    },
    handler: passthrough("set_2d_viewport"),
    kind: "passthrough",
  },
];
