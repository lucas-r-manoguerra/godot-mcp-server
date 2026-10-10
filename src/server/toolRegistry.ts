// Tool registry (design section 3): builtin/passthrough/gap/custom maps,
// custom-first resolution, Levenshtein UNKNOWN_COMMAND hints, the
// register/unregister pair, DUPLICATE_TOOL fail-fast, and the AC-07
// undo-action gate for mutating gap tools.

import type { z } from "zod";
import { toMcpError, type McpErrorShape } from "../godot/mcpErrors.js";

// Registration conflict code (spec 1.3): shadowing a builtin or
// re-registering a custom name. Never a runtime tool-call error.
export const DUPLICATE_TOOL = "DUPLICATE_TOOL";

export class DuplicateToolError extends Error {
  readonly code = DUPLICATE_TOOL;
  readonly toolName: string;

  constructor(toolName: string) {
    super(`${DUPLICATE_TOOL}: tool "${toolName}" is already registered`);
    this.name = "DuplicateToolError";
    this.toolName = toolName;
  }

  toMcp(): McpErrorShape {
    return toMcpError(DUPLICATE_TOOL, this.message, {
      retryable: false,
      command: this.toolName,
    });
  }
}

export type ToolKind = "builtin" | "passthrough" | "gap" | "custom";
export type BudgetClass = "default" | "extended";
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: unknown,
) => Promise<unknown>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: ToolHandler;
  kind: ToolKind;
  /** True for state-mutating gap tools; requires undoAction (AC-07). */
  mutating?: boolean;
  /** Named UndoRedo action; null marks the explicit v0.1.0 exemption. */
  undoAction?: string | null;
  budgetClass?: BudgetClass;
}

// Description fence (spec 3.3): exec_* tools stay a fenced escape hatch.
export const EXEC_DESCRIPTION_FENCE = "escape hatch, prefer typed tools";

export function levenshtein(a: string, b: string): number {
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}

export function suggestNames(
  name: string,
  candidates: readonly string[],
  maxDistance = 3,
): string[] {
  return candidates
    .filter((c) => levenshtein(name, c) <= maxDistance)
    .sort((x, y) => levenshtein(name, x) - levenshtein(name, y));
}

export class ToolRegistry {
  private readonly builtin = new Map<string, ToolDef>();
  private readonly passthrough = new Map<string, ToolDef>();
  private readonly gap = new Map<string, ToolDef>();
  private readonly custom = new Map<string, ToolDef>();

  /** Mirrors addon handle_command: custom first, then gap, passthrough, builtin. */
  resolve(name: string): ToolDef | undefined {
    return (
      this.custom.get(name) ??
      this.gap.get(name) ??
      this.passthrough.get(name) ??
      this.builtin.get(name)
    );
  }

  names(): string[] {
    return [
      ...this.builtin.keys(),
      ...this.passthrough.keys(),
      ...this.gap.keys(),
      ...this.custom.keys(),
    ];
  }

  // Plugin surface (spec 4). Throws DUPLICATE_TOOL on any shadowing;
  // at startup the caller aborts naming the offender (fail-fast).
  register_tool(def: ToolDef): void {
    if (this.resolve(def.name) !== undefined) {
      throw new DuplicateToolError(def.name);
    }
    // AC-07 gate: a mutating gap tool without undoAction fails
    // registration (startup), never review. Null is the explicit
    // v0.1.0 exemption (tile/animation writes, spec 3.3).
    if (def.kind === "gap" && def.mutating === true && def.undoAction === undefined) {
      throw new Error(
        `gap tool "${def.name}" is mutating but carries no undoAction`,
      );
    }
    this.mapFor(def.kind).set(def.name, def);
  }

  // Removes custom entries only; builtins never. False when absent
  // or when naming a builtin/gap/passthrough tool.
  unregister_tool(name: string): boolean {
    if (!this.custom.has(name)) return false;
    this.custom.delete(name);
    return true;
  }

  unknownCommand(name: string): McpErrorShape {
    const hints = suggestNames(name, this.names());
    const hint =
      hints.length > 0 ? `did you mean: ${hints.join(", ")}?` : "no similar tool names";
    return toMcpError("UNKNOWN_COMMAND", `UNKNOWN_COMMAND: "${name}"`, {
      retryable: false,
      hint,
      command: name,
    });
  }

  private mapFor(kind: ToolKind): Map<string, ToolDef> {
    switch (kind) {
      case "builtin": return this.builtin;
      case "passthrough": return this.passthrough;
      case "gap": return this.gap;
      case "custom": return this.custom;
    }
  }
}
