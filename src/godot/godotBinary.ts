// Godot binary discovery + version gate (design Q3, Task 9).
// Discovery order (first executable hit wins): config
// godot-mcp.godotBinary -> GODOT_BINARY env -> PATH lookup for
// `godot`, then `godot4` -> well-known locations. The version gate
// requires >= 4.5 (actionable error otherwise); a baseline (4.7.2)
// mismatch only warns and sets the drift flag. All filesystem and
// process access is injected via deps so unit tests run with a
// mocked binary and canned version strings.

export const GODOT_MIN_MAJOR = 4;
export const GODOT_MIN_MINOR = 5;
export const GODOT_BASELINE = "4.7.2";

export const WELL_KNOWN_GODOT_PATHS: readonly string[] = [
  "/usr/local/bin/godot",
  "/usr/bin/godot",
  "/Applications/Godot.app/Contents/MacOS/Godot",
  "%PROGRAMFILES%/Godot/Godot.exe",
];

export const PATH_GODOT_NAMES: readonly string[] = ["godot", "godot4"];

// Actionable failure: names every link of the discovery chain that
// was attempted. Callers convert it with toMcp() (never a raw stack).
export class GodotBinaryError extends Error {
  readonly attempted: string[];

  constructor(message: string, attempted: string[]) {
    super(message);
    this.name = "GodotBinaryError";
    this.attempted = attempted;
  }
}

export interface GodotBinaryDeps {
  configBinary?: string | null;
  env?: NodeJS.ProcessEnv;
  /** PATH lookup: binary name -> absolute path, null when absent. */
  which?: (name: string) => string | null;
  /** Executable check for explicit and well-known paths. */
  exists?: (path: string) => boolean;
}

export interface DiscoveredBinary {
  binary: string;
  source: string;
}

function defaultWhich(): (name: string) => string | null {
  return () => null;
}

function defaultExists(): (path: string) => boolean {
  return () => false;
}

// First executable hit wins; the source is logged by the caller.
// Throws GodotBinaryError naming the full attempted chain.
export function discoverGodotBinary(deps: GodotBinaryDeps = {}): DiscoveredBinary {
  const attempted: string[] = [];
  const which = deps.which ?? defaultWhich();
  const exists = deps.exists ?? defaultExists();

  const configured = deps.configBinary ?? null;
  if (configured !== null && configured.length > 0) {
    attempted.push(`config godot-mcp.godotBinary: ${configured}`);
    if (exists(configured)) {
      return { binary: configured, source: "config" };
    }
    throw new GodotBinaryError(
      `Godot binary not found: configured godot-mcp.godotBinary "${configured}" is not executable. ` +
        `Fix the config path or install Godot >= 4.5.`,
      attempted,
    );
  }

  const fromEnv = deps.env?.["GODOT_BINARY"] ?? process.env["GODOT_BINARY"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    attempted.push(`env GODOT_BINARY: ${fromEnv}`);
    if (exists(fromEnv)) {
      return { binary: fromEnv, source: "env" };
    }
    throw new GodotBinaryError(
      `Godot binary not found: GODOT_BINARY "${fromEnv}" is not executable. ` +
        `Fix the env value or install Godot >= 4.5.`,
      attempted,
    );
  }

  for (const name of PATH_GODOT_NAMES) {
    attempted.push(`PATH: ${name}`);
    const hit = which(name);
    if (hit !== null) {
      return { binary: hit, source: `PATH:${name}` };
    }
  }

  for (const candidate of WELL_KNOWN_GODOT_PATHS) {
    attempted.push(`well-known: ${candidate}`);
    if (exists(candidate)) {
      return { binary: candidate, source: `well-known:${candidate}` };
    }
  }

  throw new GodotBinaryError(
    "Godot binary not found. Searched config godot-mcp.godotBinary, " +
      "GODOT_BINARY env, PATH (godot, godot4), and well-known locations. " +
      "Install Godot >= 4.5 or set godot-mcp.godotBinary / GODOT_BINARY.",
    attempted,
  );
}

export interface GodotVersion {
  major: number;
  minor: number;
  raw: string;
}

// Parses the `4.x` feature line out of `<bin> --version` output
// (e.g. "Godot Engine v4.7.2.stable.official.ed1daf0bf"). Returns
// null when no version line is present.
export function parseGodotVersion(output: string): GodotVersion | null {
  const match = output.match(/v?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    raw: output.trim().split("\n")[0] ?? output.trim(),
  };
}

export interface VersionGate {
  version: string;
  driftSuspected: boolean;
}

// Requires >= 4.5, else throws an actionable GodotBinaryError
// (expected vs found + upgrade pointer). A baseline (4.7.2)
// mismatch sets driftSuspected without aborting.
export function gateGodotVersion(versionOutput: string): VersionGate {
  const parsed = parseGodotVersion(versionOutput);
  if (parsed === null) {
    throw new GodotBinaryError(
      `Godot version gate failed: could not parse a version from --version output. ` +
        `Expected Godot >= 4.5. Output was: ${JSON.stringify(versionOutput.slice(0, 200))}`,
      ["--version parse"],
    );
  }
  if (
    parsed.major < GODOT_MIN_MAJOR ||
    (parsed.major === GODOT_MIN_MAJOR && parsed.minor < GODOT_MIN_MINOR)
  ) {
    throw new GodotBinaryError(
      `Godot version gate failed: found ${parsed.major}.${parsed.minor}, ` +
        `require >= ${GODOT_MIN_MAJOR}.${GODOT_MIN_MINOR}. ` +
        `Upgrade Godot (baseline ${GODOT_BASELINE}) and retry.`,
      ["--version gate"],
    );
  }
  const driftSuspected = !parsed.raw.includes(GODOT_BASELINE);
  return { version: parsed.raw, driftSuspected };
}

// Last-4KB tail for per-check output (design 7).
export const OUTPUT_TAIL_BYTES = 4 * 1024;

export function tailOutput(text: string, cap: number = OUTPUT_TAIL_BYTES): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= cap) {
    return text;
  }
  let end = text.length;
  let kept = 0;
  while (end > 0 && kept < cap) {
    end -= 1;
    kept = Buffer.byteLength(text.slice(end), "utf8");
  }
  return text.slice(end);
}
