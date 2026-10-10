// Animation passthrough (spec 3.3, stratum C): verbatim re-exposure of
// the addon animation_commands.gd set (16 commands, names verbatim from
// get_commands()). Mechanical schemas: every field is an addon param with
// its addon name; requiredness mirrors the addon ("is required" checks
// stay required, everything defaulted via params.get stays .optional()).
// Write defs carry mutating + undoAction null (explicitly exempt v0.1.0,
// spec 3.3 / AC-07); play/stop/seek drive the running game, like the
// game-time tools, so they stay reads. All sends go through ctx.send.

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
const animName = z.string().min(1);

export const toolDefs: ToolDef[] = [
  {
    name: "list_animation_players",
    description: "Lists AnimationPlayer nodes under a root (defaults to the edited scene root).",
    inputSchema: {
      root_path: z.string().optional(),
    },
    handler: passthrough("list_animation_players"),
    kind: "passthrough",
  },
  {
    name: "get_animation_player_info",
    description: "Reads an AnimationPlayer's animation list and playback state.",
    inputSchema: {
      node_path: nodePath,
    },
    handler: passthrough("get_animation_player_info"),
    kind: "passthrough",
  },
  {
    name: "get_animation_details",
    description: "Reads one animation's length, loop mode, step, and track list.",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
    },
    handler: passthrough("get_animation_details"),
    kind: "passthrough",
  },
  {
    name: "get_track_keyframes",
    description: "Reads the keyframes of one animation track.",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
      track_index: z.number().int(),
    },
    handler: passthrough("get_track_keyframes"),
    kind: "passthrough",
  },
  {
    name: "play_animation",
    description: "Plays an animation on the running game (optional blend, speed, from-end).",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
      custom_blend: z.number().optional(),
      custom_speed: z.number().optional(),
      from_end: z.boolean().optional(),
    },
    handler: passthrough("play_animation"),
    kind: "passthrough",
  },
  {
    name: "stop_animation",
    description: "Stops playback on an AnimationPlayer (optional keep_state).",
    inputSchema: {
      node_path: nodePath,
      keep_state: z.boolean().optional(),
    },
    handler: passthrough("stop_animation"),
    kind: "passthrough",
  },
  {
    name: "seek_animation",
    description: "Seeks playback to a second position (optional update pass).",
    inputSchema: {
      node_path: nodePath,
      seconds: z.number(),
      update: z.boolean().optional(),
    },
    handler: passthrough("seek_animation"),
    kind: "passthrough",
  },
  {
    name: "create_animation",
    description: "Creates an animation in a player's library (optional library, length, loop mode, step).",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
      library_name: z.string().optional(),
      length: z.number().optional(),
      loop_mode: z.string().optional(),
      step: z.number().optional(),
    },
    handler: passthrough("create_animation"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "delete_animation",
    description: "Deletes an animation from a player's library (optional library).",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
      library_name: z.string().optional(),
    },
    handler: passthrough("delete_animation"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "update_animation_properties",
    description: "Updates an animation's length, loop mode, and step (all optional).",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
      length: z.number().optional(),
      loop_mode: z.string().optional(),
      step: z.number().optional(),
    },
    handler: passthrough("update_animation_properties"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "add_animation_track",
    description: "Adds a typed track at a path (optional insert position).",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
      track_type: z.string().min(1),
      track_path: z.string().min(1),
      insert_at: z.number().int().optional(),
    },
    handler: passthrough("add_animation_track"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "remove_animation_track",
    description: "Removes one animation track by index.",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
      track_index: z.number().int(),
    },
    handler: passthrough("remove_animation_track"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "add_keyframe",
    description: "Adds a keyframe with value at a time (optional transition; method tracks take method_name and args).",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
      track_index: z.number().int(),
      time: z.number(),
      value: z.unknown(),
      transition: z.number().optional(),
      method_name: z.string().optional(),
      args: z.array(z.unknown()).optional(),
    },
    handler: passthrough("add_keyframe"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "create_reset_keys",
    description: "Writes rest-value keys for one animation, or every animation when animation_name is omitted.",
    inputSchema: {
      node_path: nodePath,
      animation_name: z.string().optional(),
    },
    handler: passthrough("create_reset_keys"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "remove_keyframe",
    description: "Removes one keyframe by track and keyframe index.",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
      track_index: z.number().int(),
      keyframe_index: z.number().int(),
    },
    handler: passthrough("remove_keyframe"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
  {
    name: "update_keyframe",
    description: "Updates one keyframe's time, value, and transition (all optional).",
    inputSchema: {
      node_path: nodePath,
      animation_name: animName,
      track_index: z.number().int(),
      keyframe_index: z.number().int(),
      time: z.number().optional(),
      value: z.unknown().optional(),
      transition: z.number().optional(),
    },
    handler: passthrough("update_keyframe"),
    kind: "passthrough",
    mutating: true,
    undoAction: null, // explicitly exempt v0.1.0
  },
];
