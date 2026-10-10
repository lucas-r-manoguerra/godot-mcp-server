// Asset gap tools (spec 3.2, Task 9): import scan/reimport, uid
// resolution, paginated asset listing. Filesystem side effects, so
// UndoRedo is N/A (no undoAction). import_asset is idempotent when
// reimport=false. Every path param goes through the shared
// ScopedPathSchema (spec 3.4). All sends go through ctx.send. NEW
// addon surface: frames verbatim per spec, fixture-level tests; live
// editor behavior stays pending on the addon side.

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

// Full-object parse so the spec .default() values (reimport, limit)
// apply before the frame is built (record-of-schemas never applies
// Zod defaults; the T8 gotcha).
const importAssetSchema = z.object({
  path: ScopedPathSchema,
  reimport: z.boolean().default(false),
});

const uidResolveSchema = z.object({
  uid: z.string().regex(/^uid:\/\//),
});

const listAssetsSchema = z.object({
  glob: z.string().min(1),
  base: ScopedPathSchema.optional(),
  limit: z.number().int().default(200),
});

function gapAsset(command: string, schema: z.ZodTypeAny) {
  return (args: Record<string, unknown>, ctx: unknown): Promise<unknown> => {
    const parsed = schema.parse(args) as Record<string, unknown>;
    const context = ctx as Ctx;
    return context.send(command, dropUndefined(parsed));
  };
}

export const toolDefs: ToolDef[] = [
  {
    name: "import_asset",
    description:
      "Scans or reimports an asset (idempotent when reimport=false).",
    inputSchema: {
      path: ScopedPathSchema,
      reimport: z.boolean().default(false),
    },
    handler: gapAsset("import_asset", importAssetSchema),
    kind: "gap",
  },
  {
    name: "uid_resolve",
    description: "Resolves a uid:// identifier to its res:// path (null when unknown).",
    inputSchema: {
      uid: z.string().regex(/^uid:\/\//),
    },
    handler: gapAsset("uid_resolve", uidResolveSchema),
    kind: "gap",
  },
  {
    name: "list_assets",
    description: "Lists project assets matching a glob (paginated at limit).",
    inputSchema: {
      glob: z.string().min(1),
      base: ScopedPathSchema.optional(),
      limit: z.number().int().default(200),
    },
    handler: gapAsset("list_assets", listAssetsSchema),
    kind: "gap",
  },
];
