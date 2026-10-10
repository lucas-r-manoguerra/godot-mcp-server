// Task 1 (T1a slice): addon-error to MCP mapping for the codes that
// need no framing parser (UNKNOWN_COMMAND / ALREADY_CONNECTED).
// Parser-backed cases (INVALID_FORMAT / PARSE_ERROR) live with the
// framing tests in tests/envelope.test.ts (T1b slice).
import { describe, expect, it } from "vitest";
import { addonErrorToMcp } from "../src/godot/mcpErrors.js";

describe("framing codes (no parser)", () => {
  it("UNKNOWN_COMMAND maps non-retryable", () => {
    const mcp = addonErrorToMcp({ code: "UNKNOWN_COMMAND", message: "unknown" }, { command: "bogus" });
    expect(mcp.isError).toBe(true);
    expect(mcp._meta).toMatchObject({ code: "UNKNOWN_COMMAND", retryable: false, command: "bogus" });
    expect("stack" in (mcp as Record<string, unknown>)).toBe(false);
  });

  it("ALREADY_CONNECTED maps retryable with a handoff hint", () => {
    const mcp = addonErrorToMcp({ code: "ALREADY_CONNECTED", message: "occupied" });
    expect(mcp._meta.retryable).toBe(true);
    expect(mcp._meta.hint).toContain("single editor session");
  });
});
