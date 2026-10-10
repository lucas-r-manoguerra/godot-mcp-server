// Signal gap tools (spec 3.2, Task 9): connect/disconnect carry
// named EditorUndoRedo actions (AC-07 gate); trace_signal is
// read-only on the extended budget and is the ONLY tool allowed to
// compose more than one addon command (watch_start + watch_collect +
// watch_stop, with auto-watch_stop at duration_s or tool timeout via
// try/finally). All sends go through ctx.send. These commands are NEW
// addon surface: frames are verbatim per spec and covered at fixture
// level; live editor behavior stays pending on the addon side.

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

// Full-object parse so the spec .default() on binds applies before
// the frame is built (record-of-schemas never applies Zod defaults;
// the T8 gotcha). Optional fields stay omitted via dropUndefined.
const connectSignalSchema = z.object({
  node_path: z.string().min(1),
  signal: z.string().min(1),
  target_path: z.string().min(1),
  method: z.string().min(1),
  binds: z.array(z.unknown()).default([]),
});

const disconnectSignalSchema = z.object({
  node_path: z.string().min(1),
  signal: z.string().min(1),
  target_path: z.string().min(1),
  method: z.string().min(1),
});

const traceSignalSchema = z.object({
  node_path: z.string().min(1),
  signal: z.string().min(1),
  duration_s: z.number().positive().max(300).default(10),
});

function gapWrite(command: string, schema: z.ZodTypeAny) {
  return (args: Record<string, unknown>, ctx: unknown): Promise<unknown> => {
    const parsed = schema.parse(args) as Record<string, unknown>;
    const context = ctx as Ctx;
    return context.send(command, dropUndefined(parsed));
  };
}

// The single multi-command composition (spec 3.2): open a watch
// stream scoped to one signal, collect the buffered events, then
// always close the stream. The duration rides the watch_start frame
// (duration_ms) so the addon stops sampling at duration_s; the
// finally-stop covers the tool-timeout side ("whichever first").
// The collect result ({events, truncated}) passes through untouched.
async function traceSignal(
  args: Record<string, unknown>,
  ctx: unknown,
): Promise<unknown> {
  const parsed = traceSignalSchema.parse(args) as {
    node_path: string;
    signal: string;
    duration_s: number;
  };
  const context = ctx as Ctx;
  await context.send("watch_start", {
    signals: [`${parsed.node_path}:${parsed.signal}`],
    duration_ms: Math.round(parsed.duration_s * 1000),
  });
  try {
    return await context.send("watch_collect", {});
  } finally {
    await context.send("watch_stop", {});
  }
}

export const toolDefs: ToolDef[] = [
  {
    name: "connect_signal",
    description: "Connects a node signal to a target method (undoable).",
    inputSchema: {
      node_path: z.string().min(1),
      signal: z.string().min(1),
      target_path: z.string().min(1),
      method: z.string().min(1),
      binds: z.array(z.unknown()).default([]),
    },
    handler: gapWrite("connect_signal", connectSignalSchema),
    kind: "gap",
    mutating: true,
    undoAction: "Connect <signal> → <method>",
  },
  {
    name: "disconnect_signal",
    description: "Disconnects a node signal from a target method (undoable).",
    inputSchema: {
      node_path: z.string().min(1),
      signal: z.string().min(1),
      target_path: z.string().min(1),
      method: z.string().min(1),
    },
    handler: gapWrite("disconnect_signal", disconnectSignalSchema),
    kind: "gap",
    mutating: true,
    undoAction: "Disconnect <signal> → <method>",
  },
  {
    name: "trace_signal",
    description:
      "Traces one node signal for duration_s seconds via a watch stream (auto-stops).",
    inputSchema: {
      node_path: z.string().min(1),
      signal: z.string().min(1),
      duration_s: z.number().positive().max(300).default(10),
    },
    handler: traceSignal,
    kind: "gap",
    budgetClass: "extended",
  },
];
