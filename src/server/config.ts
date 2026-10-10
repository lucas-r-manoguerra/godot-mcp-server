// godot-mcp.* client config (design Q2): defaults + env overlay,
// resolved relative to the project root unless absolute.

import path from "node:path";

export interface GodotMcpConfig {
  // Bridge port (default 6550, explore section 1.1).
  port: number;
  // Default ws-roundtrip budget in ms (spec 5 cascade).
  relayTimeoutMs: number;
  // Watched-dir hot-load root; null when unset (design section 1).
  pluginDir: string | null;
  // Explicit Godot binary path; null means Q3 discovery (design Q3).
  godotBinary: string | null;
  // Startup plugin module paths (design Q2: godot-mcp.plugins).
  plugins: string[];
}

export const DEFAULT_PORT = 6550;
export const DEFAULT_RELAY_TIMEOUT_MS = 15000;
export const DEFAULT_PLUGIN_DIRNAME = ".godot-mcp/plugins";

export function defaultPluginDir(projectRoot: string): string {
  return path.join(projectRoot, DEFAULT_PLUGIN_DIRNAME);
}

export function defaultConfig(projectRoot: string): GodotMcpConfig {
  return {
    port: DEFAULT_PORT,
    relayTimeoutMs: DEFAULT_RELAY_TIMEOUT_MS,
    pluginDir: defaultPluginDir(projectRoot),
    godotBinary: null,
    plugins: [],
  };
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseTimeout(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function resolveAgainstRoot(value: string, projectRoot: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

export interface LoadConfigOptions {
  projectRoot?: string;
  overrides?: Partial<GodotMcpConfig>;
  env?: NodeJS.ProcessEnv;
}

// Merge order: defaults < env overlay < explicit overrides.
// Relative pluginDir/plugins entries resolve against projectRoot.
export function loadConfig(opts: LoadConfigOptions = {}): GodotMcpConfig {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const env = opts.env ?? process.env;
  const base = defaultConfig(projectRoot);

  const envPlugins = env["GODOT_MCP_PLUGINS"];
  const fromEnv: Partial<GodotMcpConfig> = {};
  if (env["GODOT_MCP_PORT"] !== undefined) {
    fromEnv.port = parsePort(env["GODOT_MCP_PORT"], base.port);
  }
  if (env["GODOT_MCP_RELAY_TIMEOUT_MS"] !== undefined) {
    fromEnv.relayTimeoutMs = parseTimeout(env["GODOT_MCP_RELAY_TIMEOUT_MS"], base.relayTimeoutMs);
  }
  if (env["GODOT_MCP_PLUGIN_DIR"] !== undefined && env["GODOT_MCP_PLUGIN_DIR"].length > 0) {
    fromEnv.pluginDir = env["GODOT_MCP_PLUGIN_DIR"];
  }
  if (env["GODOT_MCP_GODOT_BINARY"] !== undefined && env["GODOT_MCP_GODOT_BINARY"].length > 0) {
    fromEnv.godotBinary = env["GODOT_MCP_GODOT_BINARY"];
  }
  if (envPlugins !== undefined && envPlugins.length > 0) {
    fromEnv.plugins = envPlugins.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }

  const merged: GodotMcpConfig = { ...base, ...fromEnv, ...(opts.overrides ?? {}) };

  const pluginDir =
    merged.pluginDir === null ? null : resolveAgainstRoot(merged.pluginDir, projectRoot);
  const plugins = merged.plugins.map((p) => resolveAgainstRoot(p, projectRoot));
  return { ...merged, pluginDir, plugins };
}
