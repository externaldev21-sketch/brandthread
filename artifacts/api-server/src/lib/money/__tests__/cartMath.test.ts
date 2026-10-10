import { describe, expect, it } from "vitest";
import {
  CartCheckoutError, MIN_CARD_CHARGE_CENTS, allocateThreadCash, groupPreTaxRemainingCents, planCartRewards,
  taxableAmounts, threadCashGroupCeilingCents,
} from "../cartMath";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("allocateThreadCash (BT-270)", () => {
  it("gives a single store everything it asked for", () => {
    expect(allocateThreadCash(700, [1_950])).toEqual([700]);
  });

  it("splits in proportion to what each store can take, exact to the cent", () => {
    expect(allocateThreadCash(1_000, [3_000, 1_000])).toEqual([750, 250]);
    const shares = allocateThreadCash(1_001, [3_000, 1_000, 2_000])!;
    expect(sum(shares)).toBe(1_001);
    expect(shares).toEqual([500, 167, 334]);
  });

  it("never puts more on a store than its ceiling", () => {
    for (const [amount, ceilings] of [
      [999, [1, 2, 996]],
      [10, [3, 3, 3, 1]],
      [7, [1, 1, 1, 1, 1, 1, 1]],
      [12_345, [4_950, 9_950, 50, 0]],
    ] as Array<[number, number[]]>) {
      const shares = allocateThreadCash(amount, ceilings)!;
      expect(sum(shares)).toBe(amount);
      shares.forEach((share, index) => {
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(ceilings[index]);
      });
    }
  });

  it("uses all the room when the amount fills it", () => {
    expect(allocateThreadCash(60, [10, 20, 30])).toEqual([10, 20, 30]);
  });

  it("refuses more than every store together can take", () => {
    expect(allocateThreadCash(61, [10, 20, 30])).toBeNull();
    expect(allocateThreadCash(1, [0, 0])).toBeNull();
  });

  it("is zero everywhere for no Thread Cash, and rejects nonsense", () => {
    expect(allocateThreadCash(0, [100, 200])).toEqual([0, 0]);
    expect(allocateThreadCash(-1, [100])).toBeNull();
    expect(allocateThreadCash(1.5, [100])).toBeNull();
  });
});

describe("Thread Cash ceiling per store", () => {
  it("keeps Stripe's minimum card charge on every store", () => {
    const group = { subtotalCents: 2_000, shippingCents: 500, discountCents: 300 };
    expect(groupPreTaxRemainingCents(group)).toBe(2_200);
    expect(groupPreTaxRemainingCents(group, 200)).toBe(2_000);
    expect(threadCashGroupCeilingCents(2_000)).toBe(2_000 - MIN_CARD_CHARGE_CENTS);
    expect(threadCashGroupCeilingCents(30)).toBe(0);
  });
});

describe("planCartRewards", () => {
  const storeA = { subtotalCents: 3_000, shippingCents: 500, discountCents: 0 };
  const storeB = { subtotalCents: 1_000, shippingCents: 0, discountCents: 500 };

  it("spreads Thread Cash across stores, each keeping 50¢ on the card", () => {
    const plan = planCartRewards([storeA, storeB], { threadCashCents: 1_000 });
    expect(plan.loyaltyCents).toEqual([0, 0]);
    expect(sum(plan.threadCashCents)).toBe(1_000);
    // Ceilings 3,450 and 450: B never goes under 50¢.
    expect(plan.threadCashCents[1]).toBeLessThanOrEqual(450);
    expect(plan.threadCashCents).toEqual([885, 115]);
  });

  it("refuses Thread Cash that would take a store under 50¢", () => {
    expect(() => planCartRewards([storeA, storeB], { threadCashCents: 3_901 }))
      .toThrowError(expect.objectContaining({ code: "THREAD_CASH_DISCOUNT_TOO_LARGE" }));
    expect(planCartRewards([storeA, storeB], { threadCashCents: 3_900 }).threadCashCents).toEqual([3_450, 450]);
  });

  it("puts loyalty on the one store and Thread Cash after it", () => {
    const plan = planCartRewards([storeA], { loyaltyCents: 1_000, threadCashCents: 2_000 });
    expect(plan).toEqual({ loyaltyCents: [1_000], threadCashCents: [2_000] });
    expect(() => planCartRewards([storeA], { loyaltyCents: 1_000, threadCashCents: 2_451 }))
      .toThrowError(CartCheckoutError);
  });

  it("keeps loyalty to one store, as hosted Checkout does", () => {
    expect(() => planCartRewards([storeA, storeB], { loyaltyCents: 100 }))
      .toThrowError(expect.objectContaining({ code: "LOYALTY_ONE_STORE" }));
    expect(() => planCartRewards([storeA], { loyaltyCents: 3_451 }))
      .toThrowError(expect.objectContaining({ code: "LOYALTY_DISCOUNT_TOO_LARGE" }));
  });
});

describe("taxableAmounts", () => {
  const group = {
    items: [{ priceCents: 1_000, quantity: 2 }, { priceCents: 500, quantity: 1 }],
    merchandiseDiscountCents: 500,
    shippingCents: 600,
    shippingDiscountCents: 0,
  };

  it("is the promo-discounted lines and shipping without rewards", () => {
    expect(taxableAmounts(group)).toEqual({ lineAmounts: [1_600, 400], shippingCents: 600 });
  });

  it("takes rewards off merchandise first, then shipping", () => {
    expect(taxableAmounts(group, 1_000)).toEqual({ lineAmounts: [800, 200], shippingCents: 600 });
    expect(taxableAmounts(group, 2_300)).toEqual({ lineAmounts: [0, 0], shippingCents: 300 });
    expect(taxableAmounts(group, 9_999)).toEqual({ lineAmounts: [0, 0], shippingCents: 0 });
  });
});
