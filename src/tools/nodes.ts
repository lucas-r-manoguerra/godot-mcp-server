// Node-lifecycle gap tools (spec 3.2, Task 8): mutating ClassDB and
// scene-tree surface, every def carrying its named EditorUndoRedo
// action (AC-07 gate: registration fails without it). The addon
// branches create_node at runtime on `is Node3D` / `is CanvasItem`
// (no 2D/3D split) and commits ONE undo action per call, including
// batch forms. All sends go through ctx.send. Budget: default.

import { z } from "zod";
import { ScopedPathSchema } from "../godot/scopedPath.js";
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

const createNodeSchema = z.object({
  parent_path: z.string().min(1),
  class_name: z.string().min(1),
  name: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  owner_to_scene: z.boolean().default(true),
});

const instantiateSceneSchema = z.object({
  parent_path: z.string().min(1),
  scene_path: ScopedPathSchema,
  name: z.string().optional(),
  owner_to_scene: z.boolean().default(true),
});

const duplicateNodeSchema = z.object({
  node_path: z.string().min(1),
  new_name: z.string().optional(),
});

// Accident guard (spec 3.2): confirm_name MUST equal the target's leaf
// name. Enforced Zod-level in the handler before any frame is sent
// (find_nodes at-least-one precedent).
const deleteNodeSchema = z
  .object({
    node_path: z.string().min(1),
    confirm_name: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    const leaf = value.node_path.split("/").filter((part) => part !== "").pop() ?? "";
    if (value.confirm_name !== leaf) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `INVALID_FORMAT: confirm_name "${value.confirm_name}" does not match node leaf "${leaf}"`,
      });
    }
  });

function gapWrite(command: string, schema: z.ZodTypeAny) {
  return (args: Record<string, unknown>, ctx: unknown): Promise<unknown> => {
    const parsed = schema.parse(args) as Record<string, unknown>;
    const context = ctx as Ctx;
    return context.send(command, dropUndefined(parsed));
  };
}

export const toolDefs: ToolDef[] = [
  {
    name: "create_node",
    description: "Instantiates a class under a parent path and wires the owner to the scene.",
    inputSchema: {
      parent_path: z.string().min(1),
      class_name: z.string().min(1),
      name: z.string().optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
      owner_to_scene: z.boolean().default(true),
    },
    handler: gapWrite("create_node", createNodeSchema),
    kind: "gap",
    mutating: true,
    undoAction: "Create <Class> <name>",
  },
  {
    name: "instantiate_scene",
    description: "Instantiates a scene file under a parent path with scene ownership.",
    inputSchema: {
      parent_path: z.string().min(1),
      scene_path: ScopedPathSchema,
      name: z.string().optional(),
      owner_to_scene: z.boolean().default(true),
    },
    handler: gapWrite("instantiate_scene", instantiateSceneSchema),
    kind: "gap",
    mutating: true,
    undoAction: "Instantiate <scene_file>",
  },
  {
    name: "duplicate_node",
    description: "Duplicates a node, optionally under a new name.",
    inputSchema: {
      node_path: z.string().min(1),
      new_name: z.string().optional(),
    },
    handler: gapWrite("duplicate_node", duplicateNodeSchema),
    kind: "gap",
    mutating: true,
    undoAction: "Duplicate <name>",
  },
  {
    name: "delete_node",
    description: "Deletes a node; confirm_name must equal the target leaf name.",
    inputSchema: {
      node_path: z.string().min(1),
      confirm_name: z.string().min(1),
    },
    handler: gapWrite("delete_node", deleteNodeSchema),
    kind: "gap",
    mutating: true,
    undoAction: "Delete <name>",
  },
];
