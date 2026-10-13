import { describe, expect, it } from "vitest";
import {
  BUYER_CANCELLATION_WINDOW_MS,
  SELLER_CANCEL_WINDOW_HOURS,
  buyerCancelDeadline,
  buyerCancellationEligibility,
  buyerCancellationWindowMs,
  parseSellerCancelWindowHours,
} from "./buyerCancellationPolicy";

describe("buyerCancellationEligibility", () => {
  const now = Date.UTC(2026, 7, 31, 12);

  it("allows every pre-shipment status through the end of day 21", () => {
    const placed = new Date(now - BUYER_CANCELLATION_WINDOW_MS);
    for (const status of ["pending", "processing", "fulfilled"]) {
      expect(buyerCancellationEligibility(status, placed, now).eligible).toBe(true);
    }
  });

  it("rejects day 22 and shipped or delivered orders immediately", () => {
    const day22 = new Date(now - BUYER_CANCELLATION_WINDOW_MS - 1);
    expect(buyerCancellationEligibility("pending", day22, now).reason).toBe("window_expired");
    expect(buyerCancellationEligibility("shipped", new Date(now), now).reason).toBe("shipped_or_ineligible");
    expect(buyerCancellationEligibility("delivered", new Date(now), now).reason).toBe("shipped_or_ineligible");
  });
});

describe("seller-set cancellation window", () => {
  const now = Date.UTC(2026, 9, 13, 15, 40);
  const HOUR = 60 * 60 * 1000;

  it("keeps the 21-day default when the seller has not set a window", () => {
    expect(buyerCancellationWindowMs(null)).toBe(BUYER_CANCELLATION_WINDOW_MS);
    expect(buyerCancellationWindowMs(undefined)).toBe(BUYER_CANCELLATION_WINDOW_MS);
    const day21 = new Date(now - BUYER_CANCELLATION_WINDOW_MS);
    expect(buyerCancellationEligibility("pending", day21, now, null).eligible).toBe(true);
  });

  it("respects the seller's window", () => {
    expect(buyerCancellationEligibility("pending", new Date(now - HOUR), now, 1).eligible).toBe(true);
    expect(buyerCancellationEligibility("pending", new Date(now - HOUR - 1), now, 1).reason).toBe("window_expired");
    expect(buyerCancellationEligibility("processing", new Date(now - 23 * HOUR), now, 24).eligible).toBe(true);
    expect(buyerCancellationEligibility("processing", new Date(now - 73 * HOUR), now, 72).reason).toBe("window_expired");
    expect(buyerCancellationEligibility("shipped", new Date(now), now, 72).reason).toBe("shipped_or_ineligible");
  });

  it("falls back to the default for a stored value outside the list", () => {
    expect(buyerCancellationWindowMs(5)).toBe(BUYER_CANCELLATION_WINDOW_MS);
    expect(buyerCancellationWindowMs(10_000)).toBe(BUYER_CANCELLATION_WINDOW_MS);
  });

  it("accepts only the listed hours or null", () => {
    for (const hours of SELLER_CANCEL_WINDOW_HOURS) expect(parseSellerCancelWindowHours(hours)).toEqual({ ok: true, hours });
    expect(parseSellerCancelWindowHours(null)).toEqual({ ok: true, hours: null });
    for (const bad of [0, -1, 2, 1.5, 504, 10_000, "24", undefined, {}, Number.NaN]) {
      expect(parseSellerCancelWindowHours(bad).ok).toBe(false);
    }
  });

  it("returns the deadline only while the order can still be cancelled by status", () => {
    const placed = new Date(now);
    expect(buyerCancelDeadline("pending", placed, 1)).toBe(new Date(now + HOUR).toISOString());
    expect(buyerCancelDeadline("fulfilled", placed, null)).toBe(new Date(now + BUYER_CANCELLATION_WINDOW_MS).toISOString());
    expect(buyerCancelDeadline("shipped", placed, 1)).toBeNull();
    expect(buyerCancelDeadline("pending", "not a date", 1)).toBeNull();
  });
});