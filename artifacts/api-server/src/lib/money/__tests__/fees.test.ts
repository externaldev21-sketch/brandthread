import { describe, expect, it } from "vitest";
import {
  assertCents, bpsOfCents, destinationApplicationFeeCents, estimateProcessingFeeCents, MoneyError,
  platformFeeCents, platformFeeRefundCents, runningProRataShareCents, splitOrder,
} from "../fees";
import { computeApplicationFeeCents } from "../../stripe";

/** Exact half-up reference using decimal strings, independent of the code under test. */
function referenceHalfUp(amount: number, bps: number): number {
  const scaled = BigInt(amount) * BigInt(bps); // in units of 1/10 000 cent
  const whole = scaled / 10_000n;
  const remainder = scaled % 10_000n;
  return Number(remainder >= 5_000n ? whole + 1n : whole);
}

describe("5% platform fee rounding", () => {
  it.each([
    [0, 0],
    [1, 0],      // 0.05¢ → 0
    [9, 0],      // 0.45¢ → 0
    [10, 1],     // 0.5¢  → 1 (half-up)
    [11, 1],     // 0.55¢ → 1
    [29, 1],     // 1.45¢ → 1
    [30, 2],     // 1.5¢  → 2
    [99, 5],     // 4.95¢ → 5
    [100, 5],
    [1010, 51],  // $10.10 → 50.5¢ → 51¢
    [1_999, 100],// 99.95¢ → 100
    [2_010, 101],
    [123_456_789, 6_172_839], // 6 172 839.45 → 6 172 839
  ])("5%% of %i¢ is %i¢", (amount, fee) => {
    expect(platformFeeCents(amount)).toBe(fee);
  });

  it("matches an exact decimal half-up reference for every amount up to $1,000", () => {
    for (let amount = 0; amount <= 100_000; amount++) {
      if (platformFeeCents(amount) !== referenceHalfUp(amount, 500)) {
        throw new Error(`mismatch at ${amount}`);
      }
    }
  });

  it("never drifts on values where floating point multiplication misrounds", () => {
    // 0.05 is not exactly representable; these are classic trouble spots.
    for (const amount of [70, 1110, 2_345_670, 9_007_199_254_740]) {
      expect(platformFeeCents(amount)).toBe(referenceHalfUp(amount, 500));
    }
  });

  it("stays exact beyond 2^53 intermediate products", () => {
    expect(bpsOfCents(Number.MAX_SAFE_INTEGER, 500)).toBe(referenceHalfUp(Number.MAX_SAFE_INTEGER, 500));
  });

  it("keeps the legacy computeApplicationFeeCents export on the same rounding", () => {
    for (const amount of [0, 1, 10, 30, 1010, 99_999]) {
      expect(computeApplicationFeeCents(amount)).toBe(platformFeeCents(amount));
    }
    expect(computeApplicationFeeCents(-5)).toBe(0);
  });

  it("rejects fractional, negative and non-numeric cents", () => {
    expect(() => platformFeeCents(10.5)).toThrow(MoneyError);
    expect(() => platformFeeCents(-1)).toThrow(MoneyError);
    expect(() => assertCents("100")).toThrow(MoneyError);
    expect(() => assertCents(Number.NaN)).toThrow(MoneyError);
    expect(() => bpsOfCents(100, 1.5)).toThrow(MoneyError);
  });
});

describe("Stripe processing estimate (2.9% + 30¢)", () => {
  it.each([
    [0, 0],
    [1, 30],
    [100, 33],     // 2.9¢ → 3 + 30
    [1_000, 59],   // 29¢ + 30
    [10_000, 320], // $100 → $3.20
    [1_724, 80],   // 49.996 → 50 + 30
  ])("%i¢ costs %i¢", (gross, fee) => {
    expect(estimateProcessingFeeCents(gross)).toBe(fee);
  });
});

describe("splitOrder", () => {
  it("splits a $100 preorder with the exact Stripe fee", () => {
    const split = splitOrder({
      subtotalCents: 9_000, discountCents: 0, shippingCents: 500, taxCents: 500,
      grossCents: 10_000, processingFeeCents: 320,
    });
    expect(split).toEqual({
      grossCents: 10_000,
      merchandiseCents: 9_000,
      platformFeeCents: 450,
      processingFeeCents: 320,
      processingFeeSource: "actual",
      sellerNetCents: 9_230,
    });
    expect(split.platformFeeCents + split.processingFeeCents + split.sellerNetCents).toBe(split.grossCents);
  });

  it("charges 5% on merchandise after discounts, never on tax or shipping", () => {
    const split = splitOrder({
      subtotalCents: 5_000, discountCents: 1_000, shippingCents: 700, taxCents: 300, grossCents: 5_000,
    });
    expect(split.merchandiseCents).toBe(4_000);
    expect(split.platformFeeCents).toBe(200);
    expect(split.processingFeeSource).toBe("estimate");
    expect(split.processingFeeCents).toBe(estimateProcessingFeeCents(5_000));
  });

  it("never lets fees exceed the charge on a tiny order", () => {
    const split = splitOrder({
      subtotalCents: 20, discountCents: 0, shippingCents: 0, taxCents: 0, grossCents: 20,
    });
    expect(split.platformFeeCents).toBe(1);
    expect(split.processingFeeCents).toBe(19); // capped from 31
    expect(split.sellerNetCents).toBe(0);
  });

  it("handles a fully discounted order", () => {
    const split = splitOrder({
      subtotalCents: 2_000, discountCents: 2_500, shippingCents: 0, taxCents: 0, grossCents: 0,
    });
    expect(split).toMatchObject({ merchandiseCents: 0, platformFeeCents: 0, processingFeeCents: 0, sellerNetCents: 0 });
  });

  it("always conserves every cent", () => {
    for (let gross = 0; gross <= 5_000; gross += 7) {
      const split = splitOrder({
        subtotalCents: gross, discountCents: 0, shippingCents: 0, taxCents: 0, grossCents: gross,
      });
      expect(split.platformFeeCents + split.processingFeeCents + split.sellerNetCents).toBe(gross);
      expect(split.sellerNetCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("destinationApplicationFeeCents", () => {
  it("adds the processing estimate to the 5% fee", () => {
    expect(destinationApplicationFeeCents({ merchandiseCents: 10_000, preTaxTotalCents: 10_500 })).toEqual({
      platformFeeCents: 500,
      processingFeeEstimateCents: 335, // 304.5 → 305 + 30
      applicationFeeCents: 835,
    });
  });

  it("caps the fee at the charge", () => {
    const fee = destinationApplicationFeeCents({ merchandiseCents: 10, preTaxTotalCents: 10 });
    expect(fee.applicationFeeCents).toBeLessThanOrEqual(10);
  });
});

describe("platformFeeRefundCents", () => {
  it("returns the whole 5% on a full refund", () => {
    expect(platformFeeRefundCents({
      refundCents: 10_000, grossCents: 10_000, platformFeeCents: 450, platformFeeAlreadyRefundedCents: 0,
    })).toBe(450);
  });

  it("is proportional on a partial refund, rounded half-up", () => {
    // 450 × 3333 / 10000 = 149.985 → 150
    expect(platformFeeRefundCents({
      refundCents: 3_333, grossCents: 10_000, platformFeeCents: 450, platformFeeAlreadyRefundedCents: 0,
    })).toBe(150);
  });

  it("never returns more than the fee in total across many partial refunds", () => {
    let returned = 0;
    let refunded = 0;
    const gross = 10_001;
    while (refunded < gross) {
      const step = Math.min(333, gross - refunded);
      returned += platformFeeRefundCents({
        refundCents: step, grossCents: gross, platformFeeCents: 451, platformFeeAlreadyRefundedCents: returned,
      });
      refunded += step;
    }
    expect(returned).toBeLessThanOrEqual(451);
    expect(returned).toBeGreaterThanOrEqual(451 - Math.ceil(gross / 333));
  });

  it("returns nothing for zero-value inputs", () => {
    expect(platformFeeRefundCents({ refundCents: 0, grossCents: 100, platformFeeCents: 5, platformFeeAlreadyRefundedCents: 0 })).toBe(0);
    expect(platformFeeRefundCents({ refundCents: 10, grossCents: 0, platformFeeCents: 5, platformFeeAlreadyRefundedCents: 0 })).toBe(0);
  });
});

describe("runningProRataShareCents (bulk cost per released order)", () => {
  function allocate(weights: number[], cost: number): number[] {
    let unallocated = cost;
    let remaining = weights.reduce((a, b) => a + b, 0);
    return weights.map((weight, i) => {
      const share = runningProRataShareCents({
        unallocatedCostCents: unallocated,
        orderWeightCents: weight,
        remainingWeightCents: remaining,
        isLastRemainingOrder: i === weights.length - 1,
        capCents: weight,
      });
      unallocated -= share;
      remaining -= weight;
      return share;
    });
  }

  it("allocates a bulk payment to the cent across orders", () => {
    const shares = allocate([3_333, 3_333, 3_334], 5_000);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(5_000);
    expect(shares).toEqual([1_667, 1_666, 1_667]);
  });

  it("gives the last order the exact remainder", () => {
    const shares = allocate([1, 1, 1], 2);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("never charges an order more than it holds", () => {
    const shares = allocate([100, 100], 500);
    expect(shares).toEqual([100, 100]);
  });

  it("is zero when nothing was spent on bulk", () => {
    expect(allocate([500, 700], 0)).toEqual([0, 0]);
  });

  it("conserves the total for random drops", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    for (let run = 0; run < 200; run++) {
      const weights = Array.from({ length: 1 + Math.floor(rand() * 30) }, () => 100 + Math.floor(rand() * 20_000));
      const total = weights.reduce((a, b) => a + b, 0);
      const cost = Math.floor(rand() * total);
      const shares = allocate(weights, cost);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(cost);
      shares.forEach((share, i) => expect(share).toBeLessThanOrEqual(weights[i]));
    }
  });
});
