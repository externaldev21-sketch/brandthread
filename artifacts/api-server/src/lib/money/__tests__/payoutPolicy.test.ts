import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTANT_PAYOUT_PLATFORM_FEE_BPS, DOMESTIC_PAYOUT_DELAY_DAYS, INSTANT_PAYOUT_MIN_FEE_CENTS,
  INSTANT_PAYOUT_STRIPE_FEE_BPS, INTERNATIONAL_HOLD_DAYS,
  PAYOUT_PROTECTION_MODE, RESERVE_BPS, RESERVE_ROLLING_DAYS,
  computeHeldFunds, estimateNextPayout, holdReleaseDate, instantPayoutFee, instantPayoutFeeCents,
  instantPayoutPlatformFeeBps, instantPayoutTotalFeeBps, maxInstantPayoutCents,
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
  it("is 1.5% in all: Stripe's 1% plus Brandthread's 0.5%, min $0.50", () => {
    expect(INSTANT_PAYOUT_STRIPE_FEE_BPS).toBe(100);
    expect(DEFAULT_INSTANT_PAYOUT_PLATFORM_FEE_BPS).toBe(50);
    expect(instantPayoutTotalFeeBps(50)).toBe(150);
    expect(instantPayoutFee(100_000, 50)).toEqual({ stripeFeeCents: 1_000, platformFeeCents: 500, totalFeeCents: 1_500 });
    expect(instantPayoutFeeCents(100_000, 50)).toBe(1_500);
    expect(instantPayoutFeeCents(0, 50)).toBe(0);
    expect(instantPayoutFee(0, 50)).toEqual({ stripeFeeCents: 0, platformFeeCents: 0, totalFeeCents: 0 });
  });

  it("rounds each part half-up to the cent and the parts always add up", () => {
    // 150.75 -> 151 total; Stripe 100.5 -> 101; Brandthread gets the rest.
    expect(instantPayoutFee(10_050, 50)).toEqual({ stripeFeeCents: 101, platformFeeCents: 50, totalFeeCents: 151 });
    // 50.505 -> 51 total over Stripe's $0.50 minimum.
    expect(instantPayoutFee(3_367, 50)).toEqual({ stripeFeeCents: 50, platformFeeCents: 1, totalFeeCents: 51 });
    for (const amount of [1, 49, 50, 999, 3_333, 3_334, 5_000, 5_001, 12_345, 99_999, 184_250, 1_000_001]) {
      const fee = instantPayoutFee(amount, 50);
      expect(fee.stripeFeeCents + fee.platformFeeCents).toBe(fee.totalFeeCents);
      expect(fee.platformFeeCents).toBeGreaterThanOrEqual(0);
      expect(fee.totalFeeCents).toBeGreaterThanOrEqual(INSTANT_PAYOUT_MIN_FEE_CENTS);
    }
  });

  it("applies the $0.50 minimum to the total, so small payouts carry no Brandthread part", () => {
    expect(instantPayoutFee(1_000, 50)).toEqual({ stripeFeeCents: 50, platformFeeCents: 0, totalFeeCents: 50 });
    expect(instantPayoutFee(3_333, 50)).toEqual({ stripeFeeCents: 50, platformFeeCents: 0, totalFeeCents: 50 });
    expect(instantPayoutFee(4_000, 50)).toEqual({ stripeFeeCents: 50, platformFeeCents: 10, totalFeeCents: 60 });
    expect(instantPayoutFeeCents(1, 50)).toBe(INSTANT_PAYOUT_MIN_FEE_CENTS);
  });

  it("reads Brandthread's part from INSTANT_PAYOUT_PLATFORM_FEE_BPS, falling back to 50", () => {
    expect(instantPayoutPlatformFeeBps({})).toBe(50);
    expect(instantPayoutPlatformFeeBps({ INSTANT_PAYOUT_PLATFORM_FEE_BPS: "75" })).toBe(75);
    expect(instantPayoutPlatformFeeBps({ INSTANT_PAYOUT_PLATFORM_FEE_BPS: " 0 " })).toBe(0);
    expect(instantPayoutPlatformFeeBps({ INSTANT_PAYOUT_PLATFORM_FEE_BPS: "abc" })).toBe(50);
    expect(instantPayoutPlatformFeeBps({ INSTANT_PAYOUT_PLATFORM_FEE_BPS: "1.5" })).toBe(50);
    expect(instantPayoutPlatformFeeBps({ INSTANT_PAYOUT_PLATFORM_FEE_BPS: "-10" })).toBe(50);
    expect(instantPayoutPlatformFeeBps({ INSTANT_PAYOUT_PLATFORM_FEE_BPS: "501" })).toBe(50);
    expect(instantPayoutPlatformFeeBps({ INSTANT_PAYOUT_PLATFORM_FEE_BPS: "500" })).toBe(500);
    // 0 bps: the seller pays Stripe's fee only.
    expect(instantPayoutFee(100_000, 0)).toEqual({ stripeFeeCents: 1_000, platformFeeCents: 0, totalFeeCents: 1_000 });
  });

  it("never loses precision on very large amounts", () => {
    expect(instantPayoutFeeCents(9_007_199_254_740_000, 50)).toBe(135_107_988_821_100);
  });

  it("rejects non-integer or negative cents", () => {
    expect(() => instantPayoutFeeCents(10.5)).toThrow();
    expect(() => instantPayoutFeeCents(-1)).toThrow();
  });

  it("maxInstantPayoutCents is the exact largest amount that fits with its full 1.5% fee", () => {
    for (const available of [0, 49, 50, 51, 99, 100, 5_000, 5_050, 12_345, 184_250, 1_000_000]) {
      const max = maxInstantPayoutCents(available, 50);
      expect(max + (max > 0 ? instantPayoutFeeCents(max, 50) : 0)).toBeLessThanOrEqual(available);
      if (available > 0) {
        const next = max + 1;
        expect(next + instantPayoutFeeCents(next, 50)).toBeGreaterThan(available);
      }
    }
    expect(maxInstantPayoutCents(101_500, 50)).toBe(100_000);
    expect(maxInstantPayoutCents(101_000, 0)).toBe(100_000);
    expect(maxInstantPayoutCents(40, 50)).toBe(0);
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
