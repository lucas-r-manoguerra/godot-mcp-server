// Task 6 (AC-06, stratum B): the screenshot tools inject the spec-5
// economy defaults (max_width 1280, format png) unless the caller
// passes explicit values. Suite asserts the params the handler sends
// via ctx.send. Wire-level forwarding of max_width (not stripped as
// server-local) is covered by the AC-03 screenshot fixture entries in
// tests/envelope.test.ts, which deep-equal through buildOutboundFrame.
import { describe, expect, it, vi } from "vitest";
import { SCREENSHOT_DEFAULT_MAX_WIDTH } from "../src/godot/budgets.js";
import { toolDefs } from "../src/tools/passthrough/screenshots.js";

function def(name: string) {
  const found = toolDefs.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`missing toolDef "${name}"`);
  return found;
}

function stubCtx() {
  const send = vi.fn((_command: string, _params?: Record<string, unknown>) =>
    Promise.resolve({ ok: true }),
  );
  return { send, ctx: { send } as unknown };
}

describe("screenshot defaults (AC-06)", () => {
  for (const name of ["capture_game_screenshot", "capture_editor_screenshot"] as const) {
    it(`${name}: default call sends max_width 1280 and format png`, async () => {
      const { send, ctx } = stubCtx();
      await def(name).handler({}, ctx);
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]?.[0]).toBe(name);
      expect(send.mock.calls[0]?.[1]).toEqual({ max_width: 1280, format: "png" });
      expect(send.mock.calls[0]?.[1]).toEqual({
        max_width: SCREENSHOT_DEFAULT_MAX_WIDTH,
        format: "png",
      });
    });

    it(`${name}: explicit max_width and format pass through`, async () => {
      const { send, ctx } = stubCtx();
      await def(name).handler({ max_width: 640, format: "jpg" }, ctx);
      expect(send.mock.calls[0]?.[1]).toEqual({ max_width: 640, format: "jpg" });
    });

    it(`${name}: explicit path passes through, absent path is omitted`, async () => {
      const withPath = stubCtx();
      await def(name).handler({ path: "res://shots/shot.png" }, withPath.ctx);
      expect(withPath.send.mock.calls[0]?.[1]).toEqual({
        max_width: 1280,
        format: "png",
        path: "res://shots/shot.png",
      });
      const withoutPath = stubCtx();
      await def(name).handler({}, withoutPath.ctx);
      expect(withoutPath.send.mock.calls[0]?.[1]).not.toHaveProperty("path");
    });
  }
});
