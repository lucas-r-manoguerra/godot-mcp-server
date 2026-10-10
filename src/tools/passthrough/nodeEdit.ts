// Node-edit passthrough (spec 3.3, stratum A): verbatim re-exposure of
// the addon node_commands.gd set. update_node / reparent_node keep the
// addon's existing EditorUndoRedo actions ("MCP update_node ...",
// "MCP reparent_node ..."); no new undo promise is made in v0.1.0.
// All sends go through ctx.send (no direct ws import).

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

// Mirrors the addon guard: at least one of name_pattern / type is
// required, enforced before any frame is sent.
const findNodesSchema = z
  .object({
    name_pattern: z.string().optional(),
    type: z.string().optional(),
    root_path: z.string().min(1).optional(),
  })
  .refine(
    (value) => (value.name_pattern ?? "") !== "" || (value.type ?? "") !== "",
    "INVALID_FORMAT: at least one of name_pattern or type is required",
  );

export const toolDefs: ToolDef[] = [
  {
    name: "get_node_properties",
    description: "Reads the editor-visible properties of one node.",
    inputSchema: {
      node_path: z.string().min(1),
    },
    handler: passthrough("get_node_properties"),
    kind: "passthrough",
  },
  {
    name: "find_nodes",
    description: "Searches the edited scene by name pattern and/or class type.",
    inputSchema: {
      // At-least-one rule (see findNodesSchema below) is enforced in
      // the handler before any frame is sent.
      name_pattern: z.string().optional(),
      type: z.string().optional(),
      root_path: z.string().min(1).optional(),
    },
    handler: (args, ctx) => {
      findNodesSchema.parse(args);
      return passthrough("find_nodes")(args, ctx);
    },
    kind: "passthrough",
  },
  {
    name: "update_node",
    description: "Sets node properties (addon wraps the edit in its own undo action).",
    inputSchema: {
      node_path: z.string().min(1),
      properties: z.record(z.string(), z.unknown()),
    },
    handler: passthrough("update_node"),
    kind: "passthrough",
  },
  {
    name: "reparent_node",
    description: "Moves a node to a new parent (addon wraps the move in its own undo action).",
    inputSchema: {
      node_path: z.string().min(1),
      new_parent_path: z.string().min(1),
    },
    handler: passthrough("reparent_node"),
    kind: "passthrough",
  },
];
