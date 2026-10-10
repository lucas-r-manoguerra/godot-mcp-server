// Resources/3D passthrough (spec 3.3, stratum B): verbatim re-exposure
// of the addon resource_commands.gd and scene3d_commands.gd sets.
// Mechanical schemas: every field is an addon param with its addon
// name; requiredness mirrors the addon (resource_path and node_path
// are required by their commands; the rest default server-side in the
// addon, so they stay optional). All sends go through ctx.send;
// resource_path uses the shared ScopedPath guard.

import { z } from "zod";
import { ScopedPathSchema } from "../../godot/scopedPath.js";
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
    name: "get_resource_info",
    description: "Reads resource metadata (required resource_path; optional max_depth / include_internal).",
    inputSchema: {
      resource_path: ScopedPathSchema,
      max_depth: z.number().int().optional(),
      include_internal: z.boolean().optional(),
    },
    handler: passthrough("get_resource_info"),
    kind: "passthrough",
  },
  {
    name: "get_spatial_info",
    description: "Reads Node3D spatial info (required node_path; optional include_children / type_filter / max_results / within_aabb).",
    inputSchema: {
      node_path: z.string().min(1),
      include_children: z.boolean().optional(),
      type_filter: z.string().optional(),
      max_results: z.number().int().optional(),
      within_aabb: z.record(z.string(), z.unknown()).optional(),
    },
    handler: passthrough("get_spatial_info"),
    kind: "passthrough",
  },
  {
    name: "get_scene_bounds",
    description: "Computes the world-space bounds of the open scene (optional root_path subtree).",
    inputSchema: {
      root_path: z.string().min(1).optional(),
    },
    handler: passthrough("get_scene_bounds"),
    kind: "passthrough",
  },
];
