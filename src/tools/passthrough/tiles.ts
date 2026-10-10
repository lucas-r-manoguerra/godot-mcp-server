// Tiles passthrough (spec 3.3, stratum C): verbatim re-exposure of the
// addon tilemap_commands.gd set (11 TileMapLayer + 10 GridMap/MeshLibrary
// commands, names verbatim from get_commands()). Mechanical schemas: every
// field is an addon param with its addon name; requiredness mirrors the
// addon ("is required" checks stay required, params.get defaults stay
// .optional()). Write defs carry mutating + undoAction null (explicitly
// exempt v0.1.0, spec 3.3 / AC-07). convert_coords enforces its either/or
// rule Zod-level before any frame is sent (the find_nodes precedent from
// stratum A). All sends go through ctx.send.

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

const nodePath = z.string().min(1);
const vec2i = z.object({ x: z.number().int(), y: z.number().int() });
const vec3i = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() });

// Mirrors the addon guard: convert_coords needs local_position (local to
// map) or map_coords (map to local), enforced before any frame is sent.
const convertCoordsSchema = z
  .object({
    node_path: nodePath,
    local_position: z.object({ x: z.number(), y: z.number() }).optional(),
    map_coords: vec2i.optional(),
  })
  .refine(
    (value) => value.local_position !== undefined || value.map_coords !== undefined,
    "INVALID_FORMAT: either local_position or map_coords is required",
  );

const tileCellSchema = z.object({
  coords: vec2i,
  source_id: z.number().int().optional(),
  atlas_coords: vec2i.optional(),
  alternative_tile: z.number().int().optional(),
});

const gridCellSchema = z.object({
  coords: vec3i,
  item: z.number().int(),
  orientation: z.number().int().optional(),
});

export const toolDefs: ToolDef[] = [
  {
    name: "list_tilemap_layers",
    description: "Lists TileMapLayer nodes under a root (defaults to the edited scene root).",
    inputSchema: {
      root_path: z.string().optional(),
    },
    handler: passthrough("list_tilemap_layers"),
    kind: "passthrough",
  },
  {
    name: "get_tilemap_layer_info",
    description: "Reads a TileMapLayer's size, format, and enabled layers.",
    inputSchema: {
      node_path: nodePath,
    },
    handler: passthrough("get_tilemap_layer_info"),
    kind: "passthrough",
  },
  {
    name: "get_tileset_info",
    description: "Reads a layer's TileSet sources, tile size, and counts.",
    inputSchema: {
      node_path: nodePath,
    },
    handler: passthrough("get_tileset_info"),
    kind: "passthrough",
  },
  {
    name: "get_used_cells",
    description: "Reads the used cells of a TileMapLayer grouped by tile.",
    inputSchema: {
      node_path: nodePath,
    },
    handler: passthrough("get_used_cells"),
    kind: "passthrough",
  },
  {
    name: "get_cell",
    description: "Reads one TileMapLayer cell (source, atlas coords, alternative).",
    inputSchema: {
      node_path: nodePath,
      coords: vec2i,
    },
    handler: passthrough("get_cell"),
    kind: "passthrough",
  },
  {
    name: "set_cell",
    description: "Writes one TileMapLayer cell (optional source, atlas coords, alternative).",
    inputSchema: {
      node_path: nodePath,
      coords: vec2i,
      source_id: z.number().int().optional(),
      atlas_coords: vec2i.optional(),
      alternative_tile: z.number().int().optional(),
    },
    handler: passthrough("set_cell"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "erase_cell",
    description: "Erases one TileMapLayer cell.",
    inputSchema: {
      node_path: nodePath,
      coords: vec2i,
    },
    handler: passthrough("erase_cell"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "clear_layer",
    description: "Clears every cell of a TileMapLayer.",
    inputSchema: {
      node_path: nodePath,
    },
    handler: passthrough("clear_layer"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "get_cells_in_region",
    description: "Reads the used cells inside a map-coords rectangle.",
    inputSchema: {
      node_path: nodePath,
      min_coords: vec2i,
      max_coords: vec2i,
    },
    handler: passthrough("get_cells_in_region"),
    kind: "passthrough",
  },
  {
    name: "set_cells_batch",
    description: "Writes many TileMapLayer cells in one call (entries without coords are skipped).",
    inputSchema: {
      node_path: nodePath,
      cells: z.array(tileCellSchema),
    },
    handler: passthrough("set_cells_batch"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "convert_coords",
    description: "Converts between local position and map coords on a TileMapLayer.",
    inputSchema: {
      // Either/or rule (see convertCoordsSchema below) is enforced in
      // the handler before any frame is sent.
      node_path: nodePath,
      local_position: z.object({ x: z.number(), y: z.number() }).optional(),
      map_coords: vec2i.optional(),
    },
    handler: (args, ctx) => {
      convertCoordsSchema.parse(args);
      return passthrough("convert_coords")(args, ctx);
    },
    kind: "passthrough",
  },
  {
    name: "list_gridmaps",
    description: "Lists GridMap nodes under a root (defaults to the edited scene root).",
    inputSchema: {
      root_path: z.string().optional(),
    },
    handler: passthrough("list_gridmaps"),
    kind: "passthrough",
  },
  {
    name: "get_gridmap_info",
    description: "Reads a GridMap's cell size, axes, and used-cell count.",
    inputSchema: {
      node_path: nodePath,
    },
    handler: passthrough("get_gridmap_info"),
    kind: "passthrough",
  },
  {
    name: "get_meshlib_info",
    description: "Reads a GridMap's MeshLibrary items, names, and mesh paths.",
    inputSchema: {
      node_path: nodePath,
    },
    handler: passthrough("get_meshlib_info"),
    kind: "passthrough",
  },
  {
    name: "get_gridmap_used_cells",
    description: "Reads the used cells of a GridMap grouped by MeshLibrary item.",
    inputSchema: {
      node_path: nodePath,
    },
    handler: passthrough("get_gridmap_used_cells"),
    kind: "passthrough",
  },
  {
    name: "get_gridmap_cell",
    description: "Reads one GridMap cell (item, name, orientation).",
    inputSchema: {
      node_path: nodePath,
      coords: vec3i,
    },
    handler: passthrough("get_gridmap_cell"),
    kind: "passthrough",
  },
  {
    name: "set_gridmap_cell",
    description: "Writes one GridMap cell item (optional orientation).",
    inputSchema: {
      node_path: nodePath,
      coords: vec3i,
      item: z.number().int(),
      orientation: z.number().int().optional(),
    },
    handler: passthrough("set_gridmap_cell"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "clear_gridmap_cell",
    description: "Clears one GridMap cell.",
    inputSchema: {
      node_path: nodePath,
      coords: vec3i,
    },
    handler: passthrough("clear_gridmap_cell"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "clear_gridmap",
    description: "Clears every cell of a GridMap.",
    inputSchema: {
      node_path: nodePath,
    },
    handler: passthrough("clear_gridmap"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "get_cells_by_item",
    description: "Reads the GridMap cells holding one MeshLibrary item.",
    inputSchema: {
      node_path: nodePath,
      item: z.number().int(),
    },
    handler: passthrough("get_cells_by_item"),
    kind: "passthrough",
  },
  {
    name: "set_gridmap_cells_batch",
    description: "Writes many GridMap cells in one call (entries without coords or item are skipped).",
    inputSchema: {
      node_path: nodePath,
      cells: z.array(gridCellSchema),
    },
    handler: passthrough("set_gridmap_cells_batch"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
];
