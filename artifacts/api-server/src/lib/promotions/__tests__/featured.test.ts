import { afterEach, describe, expect, it } from "vitest";
import {
  FEATURED_DURATIONS, FEATURED_HOLD_MS, FEATURED_PRICE_LIST, earliestStart, featuredCapacity, featuredPriceCents,
  hasCapacity, isSlotLive, maxConcurrency, occupiesCapacity, slotDisplayState,
} from "../featured";

const NOW = new Date("2026-06-10T12:00:00Z");
const DAY = 86_400_000;
const w = (startDay: number, endDay: number) => ({
  startsAt: new Date(NOW.getTime() + startDay * DAY),
  endsAt: new Date(NOW.getTime() + endDay * DAY),
});

describe("price list", () => {
  it("only sells listed durations at the server price", () => {
    for (const d of FEATURED_DURATIONS) expect(featuredPriceCents(d)).toBe(FEATURED_PRICE_LIST[d]);
    expect(featuredPriceCents(5)).toBeNull();
    expect(featuredPriceCents("7")).toBeNull();
    expect(featuredPriceCents(7.5)).toBeNull();
    expect(featuredPriceCents(undefined)).toBeNull();
  });
});

describe("capacity", () => {
  afterEach(() => { delete process.env.FEATURED_SLOT_CAPACITY; });

  it("defaults to 4 and accepts a sane override", () => {
    expect(featuredCapacity()).toBe(4);
    process.env.FEATURED_SLOT_CAPACITY = "2";
    expect(featuredCapacity()).toBe(2);
    process.env.FEATURED_SLOT_CAPACITY = "0";
    expect(featuredCapacity()).toBe(4);
  });

  it("counts back-to-back slots as non-overlapping", () => {
    expect(maxConcurrency([w(0, 7), w(7, 14)], NOW, new Date(NOW.getTime() + 14 * DAY))).toBe(1);
  });

  it("finds the peak inside a window, not just at its start", () => {
    const windows = [w(0, 7), w(3, 10), w(4, 6)];
    expect(maxConcurrency(windows, NOW, new Date(NOW.getTime() + 10 * DAY))).toBe(3);
  });

  it("hasCapacity is strict: a full placement has none", () => {
    const full = [w(0, 7), w(0, 7)];
    expect(hasCapacity(full, NOW, new Date(NOW.getTime() + 7 * DAY), 2)).toBe(false);
    expect(hasCapacity(full, NOW, new Date(NOW.getTime() + 7 * DAY), 3)).toBe(true);
  });
});

describe("earliestStart (queue)", () => {
  it("starts now when there is room", () => {
    expect(earliestStart([w(0, 7)], 7, 2, NOW).startsAt).toEqual(NOW);
  });

  it("queues behind the first slot to end when the placement is full", () => {
    const full = [w(-2, 3), w(-1, 5)];
    const r = earliestStart(full, 7, 2, NOW);
    expect(r.startsAt).toEqual(w(3, 3).startsAt);
    expect(r.endsAt.getTime() - r.startsAt.getTime()).toBe(7 * DAY);
  });

  it("does not start in a gap that a later slot would overfill", () => {
    // capacity 1: a slot starting at day 2 blocks a 7-day purchase starting now.
    const r = earliestStart([w(2, 4)], 7, 1, NOW);
    expect(r.startsAt).toEqual(w(4, 4).startsAt);
  });

  it("scarcity: capacity N sold out pushes the next buyer past every current window", () => {
    const sold = Array.from({ length: 4 }, (_, i) => w(0, 7 + i));
    const r = earliestStart(sold, 7, 4, NOW);
    expect(r.startsAt.getTime()).toBeGreaterThanOrEqual(w(7, 7).startsAt.getTime());
  });
});

describe("occupiesCapacity", () => {
  const base = { ...w(0, 7), createdAt: NOW };
  it("holds capacity for in_review and approved slots", () => {
    expect(occupiesCapacity({ ...base, status: "in_review" }, NOW)).toBe(true);
    expect(occupiesCapacity({ ...base, status: "approved" }, NOW)).toBe(true);
  });
  it("releases rejected, cancelled, failed and finished slots", () => {
    for (const status of ["rejected", "cancelled", "failed"]) {
      expect(occupiesCapacity({ ...base, status }, NOW)).toBe(false);
    }
    expect(occupiesCapacity({ ...w(-8, -1), status: "approved", createdAt: NOW }, NOW)).toBe(false);
  });
  it("unpaid reservations only hold for the hold window", () => {
    expect(occupiesCapacity({ ...base, status: "pending_payment" }, NOW)).toBe(true);
    const later = new Date(NOW.getTime() + FEATURED_HOLD_MS + 1);
    expect(occupiesCapacity({ ...base, status: "pending_payment" }, later)).toBe(false);
  });
});

describe("live + display state", () => {
  const paid = NOW;
  it("is live only when approved, paid and inside the window", () => {
    expect(isSlotLive({ status: "approved", paidAt: paid, ...w(-1, 6) }, NOW)).toBe(true);
    expect(isSlotLive({ status: "approved", paidAt: null, ...w(-1, 6) }, NOW)).toBe(false);
    expect(isSlotLive({ status: "in_review", paidAt: paid, ...w(-1, 6) }, NOW)).toBe(false);
    expect(isSlotLive({ status: "approved", paidAt: paid, ...w(1, 8) }, NOW)).toBe(false);
    expect(isSlotLive({ status: "approved", paidAt: paid, ...w(-8, -1) }, NOW)).toBe(false);
  });

  it("maps rows to In review / Live / Rejected / Ended for the seller", () => {
    expect(slotDisplayState({ status: "in_review", paidAt: paid, ...w(0, 7) }, NOW)).toBe("in_review");
    expect(slotDisplayState({ status: "approved", paidAt: paid, ...w(-1, 6) }, NOW)).toBe("live");
    expect(slotDisplayState({ status: "approved", paidAt: paid, ...w(2, 9) }, NOW)).toBe("scheduled");
    expect(slotDisplayState({ status: "approved", paidAt: paid, ...w(-9, -2) }, NOW)).toBe("ended");
    expect(slotDisplayState({ status: "rejected", paidAt: paid, ...w(0, 7) }, NOW)).toBe("rejected");
    expect(slotDisplayState({ status: "pending_payment", paidAt: null, ...w(0, 7) }, NOW)).toBe("awaiting_payment");
  });
});
