import { describe, expect, it } from "vitest";
import {
  BROADCAST_BODY_MAX,
  BROADCAST_TITLE_MAX,
  BROADCAST_WINDOW_MS,
  broadcastWindow,
  moderateBroadcastText,
  validateBroadcastInput,
} from "./sellerPushBroadcast";

const T0 = new Date("2026-06-01T12:00:00.000Z");

describe("broadcastWindow (rolling 24h)", () => {
  it("allows the first ever broadcast", () => {
    expect(broadcastWindow(null, T0)).toEqual({ canSend: true, nextAt: null, retryAfterSec: 0 });
  });

  it("blocks until exactly 24h after the last broadcast", () => {
    const justAfter = new Date(T0.getTime() + 1_000);
    const w = broadcastWindow(T0, justAfter);
    expect(w.canSend).toBe(false);
    expect(w.nextAt?.getTime()).toBe(T0.getTime() + BROADCAST_WINDOW_MS);
    expect(w.retryAfterSec).toBe(86_399);
  });

  it("reopens at the 24h boundary and after", () => {
    const boundary = new Date(T0.getTime() + BROADCAST_WINDOW_MS);
    expect(broadcastWindow(T0, boundary).canSend).toBe(true);
    expect(broadcastWindow(T0, new Date(boundary.getTime() + 1)).canSend).toBe(true);
    expect(broadcastWindow(T0, new Date(boundary.getTime() - 1)).canSend).toBe(false);
  });

  it("is rolling, not calendar based (23:59 then 00:01 next day is still blocked)", () => {
    const late = new Date("2026-06-01T23:59:00.000Z");
    expect(broadcastWindow(late, new Date("2026-06-02T00:01:00.000Z")).canSend).toBe(false);
    expect(broadcastWindow(late, new Date("2026-06-02T23:59:00.000Z")).canSend).toBe(true);
  });
});

describe("validateBroadcastInput", () => {
  const id = "0f0c6f1e-1111-4222-8333-444455556666";

  it("trims and accepts a title + body with no link", () => {
    const r = validateBroadcastInput({ title: "  New drop  ", body: " Friday 6pm " });
    expect(r).toEqual({ ok: true, value: { title: "New drop", body: "Friday 6pm", deeplinkType: null, deeplinkId: null } });
  });

  it("enforces length limits", () => {
    expect(validateBroadcastInput({ title: "x".repeat(BROADCAST_TITLE_MAX + 1), body: "b" }).ok).toBe(false);
    expect(validateBroadcastInput({ title: "t", body: "x".repeat(BROADCAST_BODY_MAX + 1) }).ok).toBe(false);
    expect(validateBroadcastInput({ title: "x".repeat(BROADCAST_TITLE_MAX), body: "x".repeat(BROADCAST_BODY_MAX) }).ok).toBe(true);
  });

  it("requires title and body", () => {
    expect(validateBroadcastInput({ title: "", body: "b" }).ok).toBe(false);
    expect(validateBroadcastInput({ title: "t", body: "  " }).ok).toBe(false);
    expect(validateBroadcastInput(undefined).ok).toBe(false);
  });

  it("validates the deep link pair", () => {
    expect(validateBroadcastInput({ title: "t", body: "b", deeplinkType: "product", deeplinkId: id }).ok).toBe(true);
    expect(validateBroadcastInput({ title: "t", body: "b", deeplinkType: "product" }).ok).toBe(false);
    expect(validateBroadcastInput({ title: "t", body: "b", deeplinkType: "order", deeplinkId: id }).ok).toBe(false);
    expect(validateBroadcastInput({ title: "t", body: "b", deeplinkType: "drop", deeplinkId: "not-a-uuid" }).ok).toBe(false);
  });
});

describe("moderateBroadcastText", () => {
  it("allows ordinary announcements", () => {
    expect(moderateBroadcastText({ title: "Restock", body: "The black hoodie is back in all sizes." }).ok).toBe(true);
  });

  it("refuses text the public policy would hold or reject", () => {
    const r = moderateBroadcastText({ title: "Hey", body: "you are a f*cking idiot, kill yourself" });
    expect(r.ok).toBe(false);
  });
});
