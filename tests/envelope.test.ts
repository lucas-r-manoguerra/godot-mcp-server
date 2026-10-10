// Task 1 (partial): outbound builder + inbound parser + the four
// framing codes INVALID_FORMAT / PARSE_ERROR / UNKNOWN_COMMAND /
// ALREADY_CONNECTED.
import { describe, expect, it, vi } from "vitest";
import {
  buildOutboundFrame,
  parseInboundFrame,
  routeInbound,
  SERVER_LOCAL_OPTION_KEYS,
  uuidv7,
  WS_PAYLOAD_CAP_BYTES,
  EnvelopeError,
  type InboundFrame,
} from "../src/godot/envelope.js";
import envelopesFixture from "./fixtures/envelopes.json" with { type: "json" };

describe("uuidv7", () => {
  it("emits unique ids with the v7 nibble", () => {
    const a = uuidv7();
    const b = uuidv7();
    expect(a).not.toBe(b);
    expect(a[14]).toBe("7");
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("buildOutboundFrame", () => {
  it("builds {id,command,params} with passthrough params", () => {
    const frame = buildOutboundFrame("get_scene_tree", { path: "res://main.tscn" }, { id: "fixed" });
    expect(frame).toEqual({ id: "fixed", command: "get_scene_tree", params: { path: "res://main.tscn" } });
  });

  it("strips server-local options before send", () => {
    // Stratum B: max_width is a verbatim addon wire param (screenshots),
    // so it is asserted forwarded by the AC-03 screenshot fixtures, not
    // stripped here.
    const params: Record<string, unknown> = { node_path: "/root/Main", timeout_ms: 5000 };
    for (const key of SERVER_LOCAL_OPTION_KEYS) {
      params[key] = 1;
    }
    const frame = buildOutboundFrame("get_node_properties", params, { id: "x" });
    expect(frame.params).toEqual({ node_path: "/root/Main" });
  });

  it("rejects frames over 16 MB with PAYLOAD_TOO_LARGE", () => {
    const big = "A".repeat(WS_PAYLOAD_CAP_BYTES + 1);
    let caught: unknown = null;
    try {
      buildOutboundFrame("run_project", { blob: big }, { id: "big" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvelopeError);
    const err = caught as EnvelopeError;
    expect(err.code).toBe("PAYLOAD_TOO_LARGE");
    expect(err.retryable).toBe(true);
    expect(err.toMcp()._meta.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("parseInboundFrame", () => {
  it("passes success results through untouched", () => {
    const raw = JSON.stringify({ id: "1", status: "success", result: { tree: [1, 2] } });
    expect(parseInboundFrame(raw)).toEqual({ id: "1", status: "success", result: { tree: [1, 2] } });
  });

  it("parses error frames with code and message", () => {
    const raw = { id: "2", status: "error", error: { code: "UNKNOWN_COMMAND", message: "nope" } };
    expect(parseInboundFrame(raw)).toEqual(raw);
  });

  it("drops unknown ids with a log and resolves nothing", () => {
    const log = { warn: vi.fn() };
    const pending = new Map();
    const frame: InboundFrame = { id: "ghost", status: "success", result: {} };
    expect(routeInbound(frame, pending, log)).toBe(false);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0]?.[0]).toContain("ghost");
  });

  it("routes known ids to the pending entry", () => {
    const pending = new Map();
    let got: InboundFrame | null = null;
    pending.set("k", {
      resolve: (f: InboundFrame) => {
        got = f;
      },
      reject: () => {},
      command: "x",
    });
    const frame: InboundFrame = { id: "k", status: "success", result: { ok: true } };
    expect(routeInbound(frame, pending, { warn: () => {} })).toBe(true);
    expect(got).toEqual(frame);
    expect(pending.size).toBe(0);
  });
});

describe("framing codes", () => {
  it("INVALID_FORMAT on missing id", () => {
    let caught: unknown = null;
    try {
      parseInboundFrame(JSON.stringify({ status: "success", result: {} }));
    } catch (err) {
      caught = err;
    }
    expect((caught as EnvelopeError).code).toBe("INVALID_FORMAT");
    expect((caught as EnvelopeError).toMcp().isError).toBe(true);
  });

  it("PARSE_ERROR on unparseable JSON", () => {
    let caught: unknown = null;
    try {
      parseInboundFrame("{not json");
    } catch (err) {
      caught = err;
    }
    expect((caught as EnvelopeError).code).toBe("PARSE_ERROR");
    expect((caught as EnvelopeError).retryable).toBe(false);
  });

});

// Task 5 (AC-03, stratum A): every passthrough tool's outbound frame
// deep-equals its fixture and both inbound replays round-trip unchanged
// (result passthrough per spec 1.2). Later strata append entries to the
// same fixture object; this block iterates all of them.
describe("passthrough envelopes (AC-03)", () => {
  interface StratumEntry {
    outbound: { id: string; command: string; params: Record<string, unknown> };
    successInbound: unknown;
    errorInbound: unknown;
  }
  const entries = Object.entries(
    envelopesFixture as unknown as Record<string, StratumEntry>,
  );
  expect(entries.length).toBeGreaterThan(0);
  for (const [tool, entry] of entries) {
    it(`${tool}: outbound deep-equals {id,command,params}`, () => {
      const built = buildOutboundFrame(entry.outbound.command, entry.outbound.params, {
        id: entry.outbound.id,
      });
      expect(built).toEqual(entry.outbound);
    });
    it(`${tool}: success inbound round-trips untouched`, () => {
      expect(parseInboundFrame(entry.successInbound)).toEqual(entry.successInbound);
    });
    it(`${tool}: error inbound round-trips untouched`, () => {
      expect(parseInboundFrame(entry.errorInbound)).toEqual(entry.errorInbound);
    });
  }
});
