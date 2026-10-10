// Task 9: trace_signal is the ONLY multi-command tool (spec 3.2).
// The stub asserts watch_start -> watch_collect -> watch_stop order,
// the duration_s default/max mapping onto the watch_start frame, and
// the auto-stop (watch_stop still sent when collect throws).
import { describe, expect, it, vi } from "vitest";
import { toolDefs } from "../src/tools/signals.js";

function traceDef() {
  const found = toolDefs.find((tool) => tool.name === "trace_signal");
  if (found === undefined) throw new Error('missing toolDef "trace_signal"');
  return found;
}

describe("trace_signal composition", () => {
  it("sends watch_start, watch_collect, watch_stop in order", async () => {
    const order: string[] = [];
    const send = vi.fn((command: string) => {
      order.push(command);
      if (command === "watch_collect") {
        return Promise.resolve({ events: [{ t: 0, args: [] }], truncated: false });
      }
      return Promise.resolve({ ok: true });
    });
    const result = await traceDef().handler(
      { node_path: "/root/Main/Button", signal: "pressed" },
      { send } as unknown,
    );
    expect(order).toEqual(["watch_start", "watch_collect", "watch_stop"]);
    expect(result).toEqual({ events: [{ t: 0, args: [] }], truncated: false });
  });

  it("maps duration_s default 10 to duration_ms 10000 on watch_start", async () => {
    const send = vi.fn(() => Promise.resolve({}));
    await traceDef().handler(
      { node_path: "/root/Main/Button", signal: "pressed" },
      { send } as unknown,
    );
    expect(send.mock.calls[0]?.[0]).toBe("watch_start");
    expect(send.mock.calls[0]?.[1]).toEqual({
      signals: ["/root/Main/Button:pressed"],
      duration_ms: 10000,
    });
  });

  it("auto-stops when collect fails (timeout side)", async () => {
    const order: string[] = [];
    const send = vi.fn((command: string) => {
      order.push(command);
      if (command === "watch_collect") {
        return Promise.reject(new Error("RELAY_TIMEOUT"));
      }
      return Promise.resolve({ ok: true });
    });
    await expect(
      traceDef().handler(
        { node_path: "/root/Main/Button", signal: "pressed", duration_s: 30 },
        { send } as unknown,
      ),
    ).rejects.toThrowError("RELAY_TIMEOUT");
    expect(order).toEqual(["watch_start", "watch_collect", "watch_stop"]);
  });

  it("rejects duration_s over 300 before any frame", async () => {
    const send = vi.fn(() => Promise.resolve({}));
    await expect(
      traceDef().handler(
        { node_path: "/root/Main/Button", signal: "pressed", duration_s: 301 },
        { send } as unknown,
      ),
    ).rejects.toThrowError();
    expect(send).not.toHaveBeenCalled();
  });
});
