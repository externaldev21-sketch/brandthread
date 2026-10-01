import { describe, expect, it } from "vitest";
import {
  DOMESTIC_PAYOUT_DELAY_DAYS, INSTANT_PAYOUT_FEE_BPS, INSTANT_PAYOUT_MIN_FEE_CENTS, INTERNATIONAL_HOLD_DAYS,
  PAYOUT_PROTECTION_MODE, RESERVE_BPS, RESERVE_ROLLING_DAYS,
  computeHeldFunds, estimateNextPayout, holdReleaseDate, instantPayoutFeeCents, maxInstantPayoutCents,
} from "../payoutPolicy";

const DAY = 86_400_000;
const paidAt = new Date("2026-09-01T12:00:00Z");
const days = (d: Date, n: number) => new Date(d.valueOf() + n * DAY);

describe("payout policy constants", () => {
  it("defaults to hold mode and 15 international days", () => {
    expect(PAYOUT_PROTECTION_MODE).toBe("hold");
    expect(INTERNATIONAL_HOLD_DAYS).toBe(15);
  });
});

describe("holdReleaseDate", () => {
  it("hold mode: domestic uses Stripe's standard delay, international the configured days", () => {
    expect(holdReleaseDate(paidAt, "US", { mode: "hold" })).toEqual(days(paidAt, DOMESTIC_PAYOUT_DELAY_DAYS));
    expect(holdReleaseDate(paidAt, "GB", { mode: "hold" })).toEqual(days(paidAt, 15));
  });

  it("supports 15 vs 30 international days", () => {
    expect(holdReleaseDate(paidAt, "DE", { mode: "hold", internationalDays: 30 })).toEqual(days(paidAt, 30));
    expect(holdReleaseDate(paidAt, "DE", { mode: "reserve", internationalDays: 30 })).toEqual(days(paidAt, 30));
    expect(holdReleaseDate(paidAt, "DE", { mode: "reserve", internationalDays: 15 })).toEqual(days(paidAt, 15));
  });

  it("reserve mode: domestic reserve rolls for RESERVE_ROLLING_DAYS", () => {
    expect(holdReleaseDate(paidAt, "US", { mode: "reserve" })).toEqual(days(paidAt, RESERVE_ROLLING_DAYS));
  });

  it("treats a missing country as domestic and is case-insensitive", () => {
    expect(holdReleaseDate(paidAt, null, { mode: "hold" })).toEqual(days(paidAt, DOMESTIC_PAYOUT_DELAY_DAYS));
    expect(holdReleaseDate(paidAt, "us", { mode: "hold" })).toEqual(days(paidAt, DOMESTIC_PAYOUT_DELAY_DAYS));
  });

  it("starts the clock at delivery when provided", () => {
    const deliveredAt = days(paidAt, 5);
    expect(holdReleaseDate({ paidAt, deliveredAt }, "GB", { mode: "hold" })).toEqual(days(deliveredAt, 15));
  });

  it("lets the delivery-guarantee hook extend but never shorten the hold", () => {
    const later = days(paidAt, 40);
    expect(holdReleaseDate(paidAt, "GB", { mode: "hold", extraHoldUntil: () => later })).toEqual(later);
    expect(holdReleaseDate(paidAt, "GB", { mode: "hold", extraHoldUntil: () => days(paidAt, 1) })).toEqual(days(paidAt, 15));
    expect(holdReleaseDate(paidAt, "GB", { mode: "hold", extraHoldUntil: () => null })).toEqual(days(paidAt, 15));
  });

  it("rejects a missing anchor", () => {
    expect(() => holdReleaseDate({ paidAt: null, deliveredAt: null }, "US")).toThrow();
  });
});

describe("computeHeldFunds", () => {
  const orders = [
    { netCents: 10_000, paidAt, country: "US" },
    { netCents: 20_000, paidAt, country: "GB" },
    { netCents: 5_000, paidAt: days(paidAt, -60), country: "GB" },
  ];

  it("hold mode holds the whole net of unreleased orders", () => {
    const now = days(paidAt, 1);
    const held = computeHeldFunds(orders, now, { mode: "hold" });
    expect(held.heldCents).toBe(30_000);
    expect(held.count).toBe(2);
    expect(held.nextReleaseAt).toEqual(days(paidAt, 2));
  });

  it("releases domestic first, then international", () => {
    const held = computeHeldFunds(orders, days(paidAt, 3), { mode: "hold" });
    expect(held.heldCents).toBe(20_000);
    expect(computeHeldFunds(orders, days(paidAt, 15), { mode: "hold" }).heldCents).toBe(0);
  });

  it("30 day international hold keeps funds longer", () => {
    const held = computeHeldFunds(orders, days(paidAt, 20), { mode: "hold", internationalDays: 30 });
    expect(held.heldCents).toBe(20_000);
  });

  it("reserve mode holds only RESERVE_BPS of each unreleased order", () => {
    const held = computeHeldFunds(orders, days(paidAt, 1), { mode: "reserve" });
    expect(held.heldCents).toBe((10_000 * RESERVE_BPS) / 10_000 + (20_000 * RESERVE_BPS) / 10_000);
    expect(held.mode).toBe("reserve");
  });

  it("rounds the reserve half-up in integer cents", () => {
    const held = computeHeldFunds([{ netCents: 1_005, paidAt, country: "US" }], days(paidAt, 1), { mode: "reserve" });
    expect(held.heldCents).toBe(101);
    expect(Number.isInteger(held.heldCents)).toBe(true);
  });
});

describe("instant payout fee", () => {
  it("is 1% in integer cents with a minimum", () => {
    expect(INSTANT_PAYOUT_FEE_BPS).toBe(100);
    expect(instantPayoutFeeCents(100_000)).toBe(1_000);
    expect(instantPayoutFeeCents(10_050)).toBe(101); // 100.5 rounds half-up
    expect(instantPayoutFeeCents(1_000)).toBe(INSTANT_PAYOUT_MIN_FEE_CENTS);
    expect(instantPayoutFeeCents(0)).toBe(0);
  });

  it("never loses precision on very large amounts", () => {
    expect(instantPayoutFeeCents(9_007_199_254_740_000)).toBe(90_071_992_547_400);
  });

  it("rejects non-integer or negative cents", () => {
    expect(() => instantPayoutFeeCents(10.5)).toThrow();
    expect(() => instantPayoutFeeCents(-1)).toThrow();
  });

  it("maxInstantPayoutCents is the exact largest amount that fits with its fee", () => {
    for (const available of [0, 49, 50, 51, 99, 100, 5_000, 5_050, 12_345, 184_250, 1_000_000]) {
      const max = maxInstantPayoutCents(available);
      expect(max + (max > 0 ? instantPayoutFeeCents(max) : 0)).toBeLessThanOrEqual(available);
      if (available > 0) {
        const next = max + 1;
        expect(next + instantPayoutFeeCents(next)).toBeGreaterThan(available);
      }
    }
    expect(maxInstantPayoutCents(101_000)).toBe(100_000);
    expect(maxInstantPayoutCents(40)).toBe(0);
  });
});

describe("estimateNextPayout", () => {
  const now = new Date("2026-09-30T10:00:00Z"); // Wednesday

  it("prefers a payout Stripe already created", () => {
    const arrival = new Date("2026-10-02T00:00:00Z");
    const e = estimateNextPayout({
      now, interval: "daily", availableCents: 500,
      existing: { id: "po_1", amountCents: 9_000, arrivalDate: arrival },
    });
    expect(e).toEqual({ kind: "existing", date: arrival, amountCents: 9_000, payoutId: "po_1" });
  });

  it("daily: next business day, skipping weekends", () => {
    const e = estimateNextPayout({ now, interval: "daily", availableCents: 500 });
    expect(e.kind === "scheduled" && e.date.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    const friday = new Date("2026-10-02T15:00:00Z");
    const f = estimateNextPayout({ now: friday, interval: "daily", availableCents: 500 });
    expect(f.kind === "scheduled" && f.date.toISOString()).toBe("2026-10-05T12:00:00.000Z");
  });

  it("weekly: next anchor weekday", () => {
    const e = estimateNextPayout({ now, interval: "weekly", weeklyAnchor: "friday", availableCents: 500 });
    expect(e.kind === "scheduled" && e.date.toISOString()).toBe("2026-10-02T12:00:00.000Z");
    const same = estimateNextPayout({ now, interval: "weekly", weeklyAnchor: "wednesday", availableCents: 500 });
    expect(same.kind === "scheduled" && same.date.toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("subtracts held funds and reports none when nothing is payable", () => {
    const e = estimateNextPayout({ now, interval: "daily", availableCents: 1_000, heldCents: 400 });
    expect(e.amountCents).toBe(600);
    expect(estimateNextPayout({ now, interval: "daily", availableCents: 1_000, heldCents: 1_000 }).kind).toBe("none");
    expect(estimateNextPayout({ now, interval: "daily", availableCents: 0 }).kind).toBe("none");
  });

  it("manual has no date; unknown schedule is none", () => {
    expect(estimateNextPayout({ now, interval: "manual", availableCents: 700 })).toEqual({ kind: "manual", date: null, amountCents: 700 });
    expect(estimateNextPayout({ now, interval: null, availableCents: 700 }).kind).toBe("none");
  });

  it("monthly rolls to next month past the anchor", () => {
    const e = estimateNextPayout({ now, interval: "monthly", monthlyAnchor: 15, availableCents: 100 });
    expect(e.kind === "scheduled" && e.date.toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });
});
