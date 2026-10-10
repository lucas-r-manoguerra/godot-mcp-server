// verify helper (spec 3.2, design 7, Task 9): server-side
// headless-Godot checks for the repo TDD loop. Resolves the binary
// via godotBinary.ts (Q3 order), gates --version at >= 4.5, then
// runs the requested checks as subprocesses on the extended budget
// and returns {checks: [{name, ok, output_tail}], ok}. Check-level
// failures are coded entries (ok:false), never null-with-success;
// infrastructure failures (missing binary, gate, timeout) throw
// coded errors. Undo: N/A. Budget: extended.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import { EXTENDED_TIMEOUT_MS } from "../godot/budgets.js";
import {
  discoverGodotBinary,
  gateGodotVersion,
  GodotBinaryError,
  tailOutput,
  type DiscoveredBinary,
} from "../godot/godotBinary.js";
import { toMcpError } from "../godot/mcpErrors.js";
import type { ServerContext } from "../server/buildServer.js";
import type { ToolDef } from "../server/toolRegistry.js";

const execFileAsync = promisify(execFile);

export const VERIFY_CHECKS = ["import", "check-only", "playtest-smoke"] as const;
export type VerifyCheck = (typeof VERIFY_CHECKS)[number];

export const DEFAULT_VERIFY_CHECKS: VerifyCheck[] = ["import", "check-only"];
export const PLAYTEST_SMOKE_QUIT_AFTER_S = 60;

// Full-object parse so the spec .default() on checks applies (the
// T8 gotcha: record-of-schemas never applies Zod defaults).
const verifySchema = z.object({
  project_path: z.string().optional(),
  checks: z.array(z.enum(VERIFY_CHECKS)).default(DEFAULT_VERIFY_CHECKS),
});

export interface CheckResult {
  name: string;
  ok: boolean;
  output_tail: string;
}

export interface VerifyResult {
  checks: CheckResult[];
  ok: boolean;
}

// Subprocess seam: injectable so unit tests run with a mocked
// binary. Resolves {ok, output} — non-zero exits are coded results,
// timeouts throw (the caller maps them to RELAY_TIMEOUT).
export type RunHeadless = (
  binary: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<{ ok: boolean; output: string }>;

async function defaultRunHeadless(
  binary: string,
  args: string[],
  opts: { timeoutMs: number },
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout: opts.timeoutMs,
    });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (err: unknown) {
    const failure = err as { killed?: boolean; stdout?: string; stderr?: string; code?: unknown };
    if (failure.killed === true) {
      throw failure;
    }
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

function defaultWhich(name: string): string | null {
  const pathEnv = process.env["PATH"] ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  for (const dir of pathEnv.split(sep)) {
    if (dir.length === 0) continue;
    const candidate = `${dir}/${exe}`;
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export interface VerifyDeps {
  discovered?: DiscoveredBinary;
  configBinary?: string | null;
  run?: RunHeadless;
  timeoutMs?: number;
}

// Headless argv per check (design 7). playtest-smoke carries the
// documented --quit-after 60 default.
export function checkArgs(check: VerifyCheck, projectPath: string): string[] {
  switch (check) {
    case "import":
      return ["--headless", "--path", projectPath, "--import"];
    case "check-only":
      return ["--headless", "--path", projectPath, "--check-only"];
    case "playtest-smoke":
      return [
        "--headless",
        "--path",
        projectPath,
        "--quit-after",
        String(PLAYTEST_SMOKE_QUIT_AFTER_S),
      ];
  }
}

function toTimeoutMcp(timeoutMs: number): never {
  throw toMcpError("RELAY_TIMEOUT", `verify exceeded its extended budget (${timeoutMs} ms)`, {
    retryable: true,
    command: "verify",
    budget_ms: timeoutMs,
    hop: "ws-roundtrip",
  });
}

// Runs the requested checks in order and folds them into the
// {checks, ok} result. Pure against injected deps (mocked binary +
// canned version strings in tests).
export async function runVerify(
  projectPath: string,
  checks: VerifyCheck[],
  deps: VerifyDeps = {},
): Promise<VerifyResult> {
  const timeoutMs = deps.timeoutMs ?? EXTENDED_TIMEOUT_MS;
  const run = deps.run ?? defaultRunHeadless;
  const discovered =
    deps.discovered ??
    discoverGodotBinary({
      configBinary: deps.configBinary ?? null,
      which: defaultWhich,
      exists: existsSync,
    });

  let versionOutput: string;
  try {
    const gated = await run(discovered.binary, ["--version"], { timeoutMs });
    versionOutput = gated.output;
  } catch {
    toTimeoutMcp(timeoutMs);
  }
  // Throws an actionable error below the gate; warns (drift) at it.
  const gate = gateGodotVersion(versionOutput!);
  if (gate.driftSuspected) {
    console.warn(
      `godot-mcp-server: verify protocol drift suspected (godot ${gate.version}, baseline 4.7.2)`,
    );
  }

  const results: CheckResult[] = [];
  for (const check of checks) {
    let outcome: { ok: boolean; output: string };
    try {
      outcome = await run(discovered.binary, checkArgs(check, projectPath), { timeoutMs });
    } catch {
      toTimeoutMcp(timeoutMs);
    }
    results.push({
      name: check,
      ok: outcome!.ok,
      output_tail: tailOutput(outcome!.output),
    });
  }
  return { checks: results, ok: results.every((entry) => entry.ok) };
}

async function verifyHandler(
  args: Record<string, unknown>,
  ctx: unknown,
): Promise<unknown> {
  const parsed = verifySchema.parse(args) as {
    project_path?: string;
    checks: VerifyCheck[];
  };
  const context = ctx as Pick<ServerContext, "capabilities">;
  const projectPath = parsed.project_path ?? context.capabilities.project_path;
  try {
    return await runVerify(projectPath, parsed.checks, {});
  } catch (err: unknown) {
    if (err instanceof GodotBinaryError) {
      throw toMcpError("INVALID_FORMAT", err.message, {
        retryable: false,
        hint: `attempted: ${err.attempted.join(" | ")}`,
        command: "verify",
      });
    }
    throw err;
  }
}

export const toolDefs: ToolDef[] = [
  {
    name: "verify",
    description:
      "Runs headless Godot import/check/playtest-smoke checks for the repo TDD loop.",
    inputSchema: {
      project_path: z.string().optional(),
      checks: z.array(z.enum(VERIFY_CHECKS)).default(DEFAULT_VERIFY_CHECKS),
    },
    handler: verifyHandler,
    kind: "gap",
    budgetClass: "extended",
  },
];
