import { describe, expect, it } from "vitest";
import { decideLiveAttribution, LIVE_ATTRIBUTION_GRACE_MS, liveStreamIdFromItems } from "../liveAttribution";

const T0 = new Date("2026-10-07T18:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const stream = (over: Partial<{ status: string; endedAt: Date | null }> = {}) => ({
  sellerId: "host", status: "live", startedAt: T0, endedAt: null, ...over,
});

describe("decideLiveAttribution", () => {
  it("attributes the host's order while live and inside the grace window", () => {
    expect(decideLiveAttribution({ stream: stream(), orderSellerId: "host", cohostWindows: [], at: min(5) }))
      .toEqual({ ok: true, role: "host" });
    const ended = stream({ status: "ended", endedAt: min(60) });
    expect(decideLiveAttribution({ stream: ended, orderSellerId: "host", cohostWindows: [], at: min(60 + 29) }))
      .toEqual({ ok: true, role: "host" });
  });

  it("drops a purchase after the grace window or before the live started", () => {
    const ended = stream({ status: "ended", endedAt: min(60) });
    expect(decideLiveAttribution({ stream: ended, orderSellerId: "host", cohostWindows: [], at: min(60 + 31) }))
      .toEqual({ ok: false, reason: "after_grace" });
    expect(decideLiveAttribution({ stream: stream(), orderSellerId: "host", cohostWindows: [], at: min(-1) }))
      .toEqual({ ok: false, reason: "before_start" });
    expect(LIVE_ATTRIBUTION_GRACE_MS).toBe(30 * 60_000);
  });

  it("drops another seller's order unless they co-hosted, inside their time on stage + grace", () => {
    expect(decideLiveAttribution({ stream: stream(), orderSellerId: "other", cohostWindows: [], at: min(5) }))
      .toEqual({ ok: false, reason: "seller" });
    const onStage = [{ respondedAt: min(10), endedAt: null }];
    expect(decideLiveAttribution({ stream: stream(), orderSellerId: "co", cohostWindows: onStage, at: min(12) }))
      .toEqual({ ok: true, role: "cohost" });
    expect(decideLiveAttribution({ stream: stream(), orderSellerId: "co", cohostWindows: onStage, at: min(9) }))
      .toEqual({ ok: false, reason: "before_start" });
    const left = [{ respondedAt: min(10), endedAt: min(20) }];
    expect(decideLiveAttribution({ stream: stream(), orderSellerId: "co", cohostWindows: left, at: min(45) }))
      .toEqual({ ok: true, role: "cohost" });
    expect(decideLiveAttribution({ stream: stream(), orderSellerId: "co", cohostWindows: left, at: min(51) }))
      .toEqual({ ok: false, reason: "after_grace" });
  });

  it("an ended stream with no end time is never attributed", () => {
    expect(decideLiveAttribution({ stream: stream({ status: "ended" }), orderSellerId: "host", cohostWindows: [], at: min(1) }))
      .toMatchObject({ ok: false });
  });
});

describe("liveStreamIdFromItems", () => {
  it("returns the first valid per-line live source", () => {
    const id = "6f1c1f0e-8a52-4a8b-9d6f-2c7e1e3b4a5d";
    expect(liveStreamIdFromItems([{ variantId: "x" }, { sourceLiveStreamId: "nope" }, { sourceLiveStreamId: id }])).toBe(id);
    expect(liveStreamIdFromItems([{ variantId: "x" }])).toBeNull();
    expect(liveStreamIdFromItems(undefined)).toBeNull();
  });
});
