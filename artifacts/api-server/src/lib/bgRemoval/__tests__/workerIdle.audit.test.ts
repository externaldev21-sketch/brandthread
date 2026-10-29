import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn(() => true), kill: vi.fn(() => true) });
  return { fork: vi.fn(() => child), __child: child };
});
vi.mock("node:fs", async (orig) => {
  const actual = await orig<typeof import("node:fs")>();
  const existsSync = () => true;
  return { ...actual, existsSync, default: { ...actual, existsSync } };
});
vi.mock("../segmenter", () => ({
  removeBackground: vi.fn(),
  bgModelName: () => "isnet-general-use",
  ensureBgModel: vi.fn(),
}));

afterEach(() => { vi.useRealTimers(); });

describe("background-removal worker idle shutdown", () => {
  it("still shuts the warm worker down after the last request timed out", async () => {
    vi.useFakeTimers();
    const child = ((await import("node:child_process")) as unknown as { __child: { kill: ReturnType<typeof vi.fn> } }).__child;
    const { removeBackground } = await import("../index");
    const result = removeBackground(Buffer.from("img")).catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await result).toBeInstanceOf(Error);
    expect(child.kill).not.toHaveBeenCalled();
    // Default idle window (BG_REMOVAL_IDLE_MS unset) is 10 minutes.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
