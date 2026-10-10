import { describe, expect, it } from "vitest";
import { ACH_MIN_BULK_CENTS, achEligible, b2bFees, b2bProcessingEstimateCents, manufacturerNetCents } from "./fees";
import { deriveCardState, isTerminalStatus } from "./orders";

describe("B2B fees", () => {
  it("adds card processing (2.9% + 30¢) to the 5% by default", () => {
    expect(b2bFees({ priceCents: 10_000, method: "card" })).toEqual({
      chargeCents: 10_000, platformFeeCents: 500, processingFeeEstimateCents: 320, sellerSurchargeCents: 0,
      applicationFeeCents: 820, manufacturerNetCents: 9_180,
    });
  });

  it("caps ACH at $5 and charges no processing on wallet payments", () => {
    expect(b2bProcessingEstimateCents(5_000_000, "us_bank_account")).toBe(500);
    expect(b2bFees({ priceCents: 5_000_000, method: "us_bank_account" }).manufacturerNetCents).toBe(5_000_000 - 250_000 - 500);
    expect(b2bFees({ priceCents: 10_000, method: "drop_wallet" }).manufacturerNetCents).toBe(9_500);
  });

  it("never lets fees exceed the price", () => {
    const tiny = b2bFees({ priceCents: 100, method: "card" });
    expect(tiny.manufacturerNetCents).toBeGreaterThanOrEqual(0);
    expect(tiny.applicationFeeCents).toBeLessThanOrEqual(100);
  });

  it("offers ACH only on bulk cards at or above the threshold", () => {
    expect(achEligible({ orderType: "bulk", priceCents: ACH_MIN_BULK_CENTS })).toBe(true);
    expect(achEligible({ orderType: "bulk", priceCents: ACH_MIN_BULK_CENTS - 1 })).toBe(false);
    expect(achEligible({ orderType: "sample", priceCents: ACH_MIN_BULK_CENTS * 10 })).toBe(false);
  });

  it("estimates the manufacturer's net before payment and uses the fixed net after", () => {
    expect(manufacturerNetCents({ priceCents: 10_000 })).toBe(9_180);
    expect(manufacturerNetCents({ priceCents: 10_000, manufacturerNetCents: 9_500 })).toBe(9_500);
  });
});

describe("refunded cards", () => {
  it("is terminal and renders as refunded for both sides", () => {
    expect(isTerminalStatus("refunded")).toBe(true);
    expect(deriveCardState({ status: "refunded", orderType: "bulk" }, "seller")).toMatchObject({ phase: "cancelled", headline: "Refunded", actions: [] });
  });
});
