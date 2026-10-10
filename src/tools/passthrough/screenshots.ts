// Screenshot passthrough (spec 3.3 and 5, stratum B): verbatim
// re-exposure of the addon screenshot_commands.gd set. The server
// injects the spec-5 economy defaults (max_width 1280, format png)
// unless the caller passes explicit values; path passes through only
// when given. All sends go through ctx.send; path uses the shared
// ScopedPath guard (spec 3.4).
//
// NOTE: max_width is a verbatim addon wire param
// (screenshot_commands.gd reads params.get("max_width")), NOT a
// server-local option: envelope.buildOutboundFrame must forward it
// (see the SERVER_LOCAL_OPTION_KEYS fix in this slice, AC-06).

import { z } from "zod";
import {
  SCREENSHOT_DEFAULT_FORMAT,
  resolveScreenshotMaxWidth,
} from "../../godot/budgets.js";
import { ScopedPathSchema } from "../../godot/scopedPath.js";
import type { ServerContext } from "../../server/buildServer.js";
import type { ToolDef } from "../../server/toolRegistry.js";

type Ctx = Pick<ServerContext, "send">;

function screenshotHandler(command: string) {
  return (args: Record<string, unknown>, ctx: unknown): Promise<unknown> => {
    const context = ctx as Ctx;
    const params: Record<string, unknown> = {
      max_width: resolveScreenshotMaxWidth(args["max_width"] as number | undefined),
      format: (args["format"] as string | undefined) ?? SCREENSHOT_DEFAULT_FORMAT,
    };
    if (args["path"] !== undefined) params["path"] = args["path"];
    return context.send(command, params);
  };
}

const screenshotSchema = {
  max_width: z.number().int().optional(),
  format: z.string().optional(),
  path: ScopedPathSchema.optional(),
};

export const toolDefs: ToolDef[] = [
  {
    name: "capture_game_screenshot",
    description: "Captures the running game viewport (server injects max_width 1280 / format png defaults).",
    inputSchema: { ...screenshotSchema },
    handler: screenshotHandler("capture_game_screenshot"),
    kind: "passthrough",
  },
  {
    name: "capture_editor_screenshot",
    description: "Captures the active editor viewport (server injects max_width 1280 / format png defaults).",
    inputSchema: { ...screenshotSchema },
    handler: screenshotHandler("capture_editor_screenshot"),
    kind: "passthrough",
  },
];
