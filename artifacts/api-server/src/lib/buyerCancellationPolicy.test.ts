import { describe, expect, it } from "vitest";
import {
  BUYER_CANCELLATION_WINDOW_MS,
  buyerCancellationEligibility,
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