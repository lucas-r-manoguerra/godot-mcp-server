// Plugin loader (spec 4, design Q2): startup load from
// `godot-mcp.plugins` + watched-dir hot-load from
// `godot-mcp.pluginDir` (default `<project>/.godot-mcp/plugins/`).
// This module is the SOLE non-test caller of `unregister_tool`:
// file removal/reload unregisters that file's tools; in-flight calls
// hold their handler reference directly, so they complete normally,
// and freed names may re-register without DUPLICATE_TOOL.
//
// Handler confinement: plugin handlers receive the shared `ctx` and
// MUST go through `ctx.send` only (no raw WS access). The core limits
// below are enforced at load time; every violation fails with a
// pointer to specs.md section 4.

import { pathToFileURL } from "node:url";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { defaultPluginDir, type GodotMcpConfig } from "./config.js";
import {
  ToolRegistry,
  type ToolDef,
} from "./toolRegistry.js";

// Core limits (spec 4, normative): what MUST NEVER enter core.
// Plugin defs are structurally confined to the custom map (kind is
// forced below), so game-content pilots stay project-side by
// construction; transport/sync-IO/listener/binary patterns fail the
// handler source scan with a pointer to specs.md section 4.
export const CORE_PLUGIN_LIMITS: readonly string[] = [
  "no game-content tools in core (infinity_mu_* pilots stay project-side)",
  "no transport-specific code in handlers (use ctx.send only)",
  "no blocking synchronous I/O in handlers",
  "no unauthenticated network listeners",
  "no binary asset vendoring",
];
export const PLUGIN_LIMITS_POINTER = "see specs.md section 4 (Plugin API)";

export class PluginConfinementError extends Error {
  readonly toolName: string;
  readonly reason: string;

  constructor(toolName: string, reason: string) {
    super(
      `plugin tool "${toolName}" violates core confinement: ${reason} (${PLUGIN_LIMITS_POINTER})`,
    );
    this.name = "PluginConfinementError";
    this.toolName = toolName;
    this.reason = reason;
  }
}

export class PluginStartupError extends Error {
  readonly pluginPath: string;

  constructor(pluginPath: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`plugin startup aborted: offender "${pluginPath}": ${detail}`);
    this.name = "PluginStartupError";
    this.pluginPath = pluginPath;
  }
}

// Handler source patterns that prove the handler escapes the ctx.send
// confinement (spec 4: handlers MUST go through ctx.send, no raw WS).
const FORBIDDEN_HANDLER_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  { pattern: /\bWebSocket\b/, reason: "raw WebSocket access in handler" },
  {
    pattern: /wsClient|StdioServerTransport|StreamableHTTPServerTransport/,
    reason: "transport-specific code in handler",
  },
  {
    pattern: /\.listen\s*\(|createServer|node:(net|http|https|dgram)/,
    reason: "unauthenticated network listener in handler",
  },
  {
    pattern: /execSync|spawnSync|readFileSync|writeFileSync|appendFileSync/,
    reason: "blocking synchronous I/O in handler",
  },
  {
    pattern: /;base64,/,
    reason: "binary asset vendoring in handler",
  },
];

export function assertHandlerConfined(def: ToolDef): void {
  const source = Function.prototype.toString.call(def.handler);
  for (const { pattern, reason } of FORBIDDEN_HANDLER_PATTERNS) {
    if (pattern.test(source)) {
      throw new PluginConfinementError(def.name, reason);
    }
  }
}

// Game-content pilot names (project-side by rule, never core).
export function isGameContentName(name: string): boolean {
  return name.startsWith("infinity_mu_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Closed core: plugin defs ALWAYS land in the custom map, whatever
// kind the module declares. Game-content pilots included — they stay
// project-side as custom tools and can never shadow core strata.
export function normalizePluginDef(specifier: string, raw: unknown): ToolDef {
  if (!isRecord(raw)) {
    throw new PluginConfinementError(specifier, "def is not an object");
  }
  const name = raw["name"];
  const description = raw["description"];
  const inputSchema = raw["inputSchema"];
  const handler = raw["handler"];
  if (typeof name !== "string" || name.length === 0) {
    throw new PluginConfinementError(specifier, "def has no usable name");
  }
  if (typeof description !== "string" || description.length === 0) {
    throw new PluginConfinementError(name, "def has no description");
  }
  if (!isRecord(inputSchema)) {
    throw new PluginConfinementError(name, "def has no inputSchema record");
  }
  if (typeof handler !== "function") {
    throw new PluginConfinementError(name, "def handler is not a function");
  }
  const def: ToolDef = {
    ...(raw as Omit<ToolDef, "kind">),
    name,
    description,
    inputSchema: inputSchema as ToolDef["inputSchema"],
    handler: handler as ToolDef["handler"],
    kind: "custom",
  };
  assertHandlerConfined(def);
  return def;
}

// Plugin module contract: a `toolDefs` array, either as a named
// export, as `default.toolDefs`, or as the whole default export.
export function normalizePluginModule(specifier: string, mod: unknown): ToolDef[] {
  if (!isRecord(mod)) {
    throw new PluginStartupError(specifier, "module exports nothing usable");
  }
  const candidate =
    (mod as { toolDefs?: unknown }).toolDefs ??
    (mod as { default?: unknown }).default;
  const list = isRecord(candidate) && Array.isArray((candidate as { toolDefs?: unknown }).toolDefs)
    ? (candidate as { toolDefs: unknown }).toolDefs
    : candidate;
  if (!Array.isArray(list)) {
    throw new PluginStartupError(
      specifier,
      "module must export a toolDefs array (named or default)",
    );
  }
  return list.map((raw) => normalizePluginDef(specifier, raw));
}

export type PluginModuleImporter = (specifier: string) => Promise<unknown>;

export async function defaultPluginImporter(specifier: string): Promise<unknown> {
  const href = path.isAbsolute(specifier)
    ? pathToFileURL(specifier).href
    : specifier;
  return import(href);
}

export interface LoadStartupPluginsOptions {
  registry: ToolRegistry;
  plugins: string[];
  importer?: PluginModuleImporter;
}

// Startup load (config `godot-mcp.plugins`): sequential, fail-fast.
// ANY failure — missing module, malformed def, confinement breach,
// DUPLICATE_TOOL shadowing — aborts by throwing PluginStartupError
// naming the offending module path.
export async function loadStartupPlugins(
  opts: LoadStartupPluginsOptions,
): Promise<string[]> {
  const importer = opts.importer ?? defaultPluginImporter;
  const loaded: string[] = [];
  for (const specifier of opts.plugins) {
    try {
      const mod = await importer(specifier);
      const defs = normalizePluginModule(specifier, mod);
      for (const def of defs) {
        opts.registry.register_tool(def);
        loaded.push(def.name);
      }
    } catch (err) {
      if (err instanceof PluginStartupError) throw err;
      throw new PluginStartupError(specifier, err);
    }
  }
  return loaded;
}

export function resolvePluginDir(
  config: Pick<GodotMcpConfig, "pluginDir">,
  projectRoot: string,
): string {
  return config.pluginDir ?? defaultPluginDir(projectRoot);
}

export interface HotLoadResult {
  loaded: string[];
  skipped: Array<{ file: string; reason: string }>;
}

// Watched-dir hot-load: per-file isolation. A failing file is
// logged + skipped; the server (and the other files) stay up.
export class PluginHotLoader {
  private readonly registry: ToolRegistry;
  private readonly importer: PluginModuleImporter;
  private readonly fileTools = new Map<string, string[]>();

  constructor(registry: ToolRegistry, importer?: PluginModuleImporter) {
    this.registry = registry;
    this.importer = importer ?? defaultPluginImporter;
  }

  toolsFor(filePath: string): string[] {
    return [...(this.fileTools.get(filePath) ?? [])];
  }

  async loadFile(filePath: string): Promise<string[]> {
    if (this.fileTools.has(filePath)) {
      await this.unloadFile(filePath);
    }
    const mod = await this.importer(filePath);
    const defs = normalizePluginModule(filePath, mod);
    const names: string[] = [];
    try {
      for (const def of defs) {
        this.registry.register_tool(def);
        names.push(def.name);
      }
    } catch (err) {
      for (const name of names) this.registry.unregister_tool(name);
      throw err;
    }
    this.fileTools.set(filePath, names);
    return [...names];
  }

  // SOLE non-test caller of unregister_tool. Dropping the map entry
  // does not touch handlers already running: in-flight calls hold
  // their own reference and complete; the names are immediately
  // re-registrable by a later load.
  async unloadFile(filePath: string): Promise<boolean> {
    const names = this.fileTools.get(filePath);
    if (names === undefined) return false;
    for (const name of names) this.registry.unregister_tool(name);
    this.fileTools.delete(filePath);
    return true;
  }

  async reloadFile(filePath: string): Promise<string[]> {
    await this.unloadFile(filePath);
    return this.loadFile(filePath);
  }

  async loadFiles(filePaths: string[]): Promise<HotLoadResult> {
    const result: HotLoadResult = { loaded: [], skipped: [] };
    for (const filePath of filePaths) {
      try {
        const names = await this.loadFile(filePath);
        result.loaded.push(...names);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        result.skipped.push({ file: filePath, reason });
        console.warn(`godot-mcp-server: hot-load skipped "${filePath}": ${reason}`);
      }
    }
    return result;
  }

  async loadDir(
    dirPath: string,
    deps: { readdir?: (dir: string) => Promise<string[]> } = {},
  ): Promise<HotLoadResult> {
    const read = deps.readdir ?? readdir;
    let entries: string[];
    try {
      entries = await read(dirPath);
    } catch {
      return { loaded: [], skipped: [] };
    }
    const files = entries
      .filter((e) => e.endsWith(".ts") || e.endsWith(".js") || e.endsWith(".mjs") || e.endsWith(".cjs"))
      .sort()
      .map((e) => path.join(dirPath, e));
    return this.loadFiles(files);
  }
}
