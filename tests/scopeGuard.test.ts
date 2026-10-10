// Task 1 (partial): 5-case matrix on the guard function alone.
// Per-tool expansion lands in Task 10.
import { describe, expect, it } from "vitest";
import { assertScopedPath, ScopedPathError, validate_scoped_path } from "../src/godot/scopedPath.js";

describe("validate_scoped_path matrix", () => {
  const cases: Array<[string, boolean]> = [
    ["res://scenes/main.tscn", true],
    ["user://saves/slot1.save", true],
    ["uid://b1x2y3z4", true],
    ["/abs/path.tscn", false],
    ["res://../escape.tscn", false],
  ];
  for (const [input, expected] of cases) {
    it(`${expected ? "allows" : "rejects"} ${input}`, () => {
      expect(validate_scoped_path(input)).toBe(expected);
    });
  }

  it("throwing variant names the offending value", () => {
    let caught: unknown = null;
    try {
      assertScopedPath("/abs/path.tscn");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ScopedPathError);
    const mcp = (caught as ScopedPathError).toMcp();
    expect(mcp.isError).toBe(true);
    expect(mcp._meta.code).toBe("INVALID_FORMAT");
    expect(mcp.content[0]?.text).toContain("/abs/path.tscn");
  });
});
