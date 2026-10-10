// Path scope guard (spec 3.4): allow res://, user:// and resolvable
// uid://; reject absolutes and ".." escapes with a structured
// INVALID_FORMAT-shaped MCP error naming the offending value.

import { z } from "zod";
import { toMcpError, type McpErrorShape } from "./mcpErrors.js";

export class ScopedPathError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`INVALID_FORMAT: scoped path rejected: "${path}"`);
    this.name = "ScopedPathError";
    this.path = path;
  }

  toMcp(): McpErrorShape {
    return toMcpError("INVALID_FORMAT", this.message, {
      retryable: false,
      hint: "use res://, user://, or a resolvable uid:// path without \"..\"",
    });
  }
}

function hasDotDotSegment(path: string): boolean {
  return path.split("/").includes("..");
}

function isAbsoluteLike(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

// Core predicate. Pure boolean so every path-taking tool (core and
// plugin) can share it through ctx.send.
export function validate_scoped_path(path: string): boolean {
  if (path.length === 0 || isAbsoluteLike(path) || hasDotDotSegment(path)) {
    return false;
  }
  if (path.startsWith("res://") || path.startsWith("user://")) {
    return true;
  }
  if (path.startsWith("uid://")) {
    const rest = path.slice("uid://".length);
    return rest.length > 0 && /^[A-Za-z0-9]+$/.test(rest);
  }
  return false;
}

// Throwing variant for call sites that fail Zod-level before any frame
// is sent.
export function assertScopedPath(path: string): void {
  if (!validate_scoped_path(path)) {
    throw new ScopedPathError(path);
  }
}

// Shared Zod schema for every path-taking tool (core AND plugin).
export const ScopedPathSchema = z
  .string()
  .refine(
    (value: string) => validate_scoped_path(value),
    "INVALID_FORMAT: scoped path rejected",
  );
