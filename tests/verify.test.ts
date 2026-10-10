// Task 9: verify discovery order + version gate unit tests with a
// mocked binary and canned version strings (design Q3). No real
// Godot process is spawned; the subprocess seam is injected.
import { describe, expect, it, vi } from "vitest";
import {
  discoverGodotBinary,
  gateGodotVersion,
  GodotBinaryError,
  parseGodotVersion,
  tailOutput,
} from "../src/godot/godotBinary.js";
import {
  checkArgs,
  runVerify,
  type VerifyCheck,
} from "../src/tools/verify.js";

const V472 = "Godot Engine v4.7.2.stable.official.ed1daf0bf";
const V45 = "Godot Engine v4.5.stable.official";
const V43 = "Godot Engine v4.3.stable.official";

describe("discoverGodotBinary order", () => {
  it("config wins over env and PATH", () => {
    const got = discoverGodotBinary({
      configBinary: "/opt/godot",
      env: { GODOT_BINARY: "/env/godot" },
      which: () => "/usr/bin/godot",
      exists: () => true,
    });
    expect(got).toEqual({ binary: "/opt/godot", source: "config" });
  });

  it("env wins over PATH when no config", () => {
    const got = discoverGodotBinary({
      env: { GODOT_BINARY: "/env/godot" },
      which: () => "/usr/bin/godot",
      exists: () => true,
    });
    expect(got).toEqual({ binary: "/env/godot", source: "env" });
  });

  it("PATH prefers godot over godot4", () => {
    const which = vi.fn((name: string) => (name === "godot" ? "/usr/bin/godot" : null));
    const got = discoverGodotBinary({ env: {}, which, exists: () => false });
    expect(got).toEqual({ binary: "/usr/bin/godot", source: "PATH:godot" });
  });

  it("falls through to well-known locations", () => {
    const got = discoverGodotBinary({
      env: {},
      which: () => null,
      exists: (path) => path === "/usr/bin/godot",
    });
    expect(got.binary).toBe("/usr/bin/godot");
    expect(got.source).toContain("well-known");
  });

  it("missing binary throws an actionable error naming the chain", () => {
    let caught: unknown = null;
    try {
      discoverGodotBinary({ env: {}, which: () => null, exists: () => false });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GodotBinaryError);
    const err = caught as GodotBinaryError;
    expect(err.message).toContain(">= 4.5");
    expect(err.attempted.join(" ")).toContain("PATH: godot");
  });
});

describe("version gate", () => {
  it("parses the 4.x feature line", () => {
    expect(parseGodotVersion(V472)).toMatchObject({ major: 4, minor: 7 });
    expect(parseGodotVersion("no version here")).toBeNull();
  });

  it("accepts >= 4.5 and flags baseline drift", () => {
    expect(gateGodotVersion(V472).driftSuspected).toBe(false);
    const gated = gateGodotVersion(V45);
    expect(gated.driftSuspected).toBe(true);
  });

  it("rejects < 4.5 with expected-vs-found", () => {
    expect(() => gateGodotVersion(V43)).toThrowError(/4\.3.*>= 4\.5|>= 4\.5.*4\.3/s);
  });

  it("rejects unparseable output", () => {
    expect(() => gateGodotVersion("garbage")).toThrowError(GodotBinaryError);
  });
});

describe("runVerify with mocked binary", () => {
  const checks: VerifyCheck[] = ["import", "check-only"];

  it("returns {checks, ok:true} when every check passes", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ ok: true as boolean, output: "ok" }),
    );
    // First call is --version; the mock answers per argv below.
    run.mockImplementation(((_bin: string, args: string[]) => {
      if (args.includes("--version")) return Promise.resolve({ ok: true, output: V472 });
      return Promise.resolve({ ok: true, output: `${args.join(" ")} done` });
    }) as never);
    const result = await runVerify("/proj", checks, {
      discovered: { binary: "/mock/godot", source: "test" },
      run,
    });
    expect(result.ok).toBe(true);
    expect(result.checks.map((entry) => entry.name)).toEqual(checks);
  });

  it("codes check failures as ok:false entries, never null-with-success", async () => {
    const run = vi.fn((_bin: string, args: string[]) => {
      if (args.includes("--version")) return Promise.resolve({ ok: true, output: V472 });
      if (args.includes("--check-only")) {
        return Promise.resolve({ ok: false, output: "SCRIPT ERROR: parse" });
      }
      return Promise.resolve({ ok: true, output: "import done" });
    });
    const result = await runVerify("/proj", checks, {
      discovered: { binary: "/mock/godot", source: "test" },
      run: run as never,
    });
    expect(result.ok).toBe(false);
    expect(result.checks).toHaveLength(2);
    expect(result.checks[1]).toMatchObject({ name: "check-only", ok: false });
    expect(result.checks[1]?.output_tail).toContain("SCRIPT ERROR");
  });

  it("tails check output at 4 KB", async () => {
    const big = "x".repeat(9000);
    const tail = tailOutput(big);
    expect(Buffer.byteLength(tail, "utf8")).toBeLessThanOrEqual(4 * 1024);
    expect(big.endsWith(tail)).toBe(true);
  });

  it("playtest-smoke carries --quit-after 60", () => {
    expect(checkArgs("playtest-smoke", "/proj")).toContain("--quit-after");
    expect(checkArgs("playtest-smoke", "/proj")).toContain("60");
  });
});
