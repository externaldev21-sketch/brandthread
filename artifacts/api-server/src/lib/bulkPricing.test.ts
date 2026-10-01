import { describe, expect, it } from "vitest";
import {
  MAX_PRICE_CENTS, computeNewPrice, isValidPriceChange, planProductPrices,
  resolveCompareAt, roundPrice, uniqueCopySku,
} from "./bulkPricing";

describe("computeNewPrice", () => {
  it("sets an exact price", () => {
    expect(computeNewPrice(4500, { mode: "set", value: 3999 })).toBe(3999);
  });

  it("raises and lowers by percent (basis points)", () => {
    expect(computeNewPrice(4000, { mode: "percent", direction: "increase", value: 1000 })).toBe(4400);
    expect(computeNewPrice(4000, { mode: "percent", direction: "decrease", value: 2500 })).toBe(3000);
    expect(computeNewPrice(999, { mode: "percent", direction: "decrease", value: 1050 })).toBe(894); // 893.9 -> 894
  });

  it("raises and lowers by a fixed amount", () => {
    expect(computeNewPrice(4000, { mode: "amount", direction: "increase", value: 250 })).toBe(4250);
    expect(computeNewPrice(4000, { mode: "amount", direction: "decrease", value: 500 })).toBe(3500);
  });

  it("never goes below one cent", () => {
    expect(computeNewPrice(500, { mode: "amount", direction: "decrease", value: 9999 })).toBe(1);
    expect(computeNewPrice(500, { mode: "percent", direction: "decrease", value: 10000 })).toBe(1);
    expect(computeNewPrice(500, { mode: "percent", direction: "decrease", value: 20000 })).toBe(1);
  });

  it("caps at the maximum price", () => {
    expect(computeNewPrice(MAX_PRICE_CENTS - 10, { mode: "amount", direction: "increase", value: 5000 })).toBe(MAX_PRICE_CENTS);
  });

  it("ends in .99 at the nearest dollar", () => {
    expect(computeNewPrice(2047, { mode: "set", value: 2047 }, "end_99")).toBe(1999);
    expect(computeNewPrice(2060, { mode: "set", value: 2060 }, "end_99")).toBe(2099);
    expect(computeNewPrice(4000, { mode: "percent", direction: "decrease", value: 1000 }, "end_99")).toBe(3599);
    expect(computeNewPrice(40, { mode: "set", value: 40 }, "end_99")).toBe(99);
  });

  it("ends in .00", () => {
    expect(computeNewPrice(1999, { mode: "set", value: 1999 }, "end_00")).toBe(2000);
    expect(computeNewPrice(30, { mode: "set", value: 30 }, "end_00")).toBe(100);
  });

  it("rounding never moves a price against the requested direction", () => {
    // 20.00 less 0.5% = 19.90 -> nearest .99 is 19.99, still below 20.00
    expect(computeNewPrice(2000, { mode: "percent", direction: "decrease", value: 50 }, "end_99")).toBe(1999);
    // 19.99 less 0.1% = 19.97 -> would round to 19.99 (unchanged, not higher)
    expect(computeNewPrice(1999, { mode: "percent", direction: "decrease", value: 10 }, "end_99")).toBe(1999);
    // 20.01 less 1 cent rounds to 20.99 on .99 snapping — must stay at or below 20.01
    expect(computeNewPrice(2001, { mode: "amount", direction: "decrease", value: 1 }, "end_99")).toBeLessThanOrEqual(2001);
    // 19.50 plus 1 cent rounds to 19.99 — fine; 19.99 plus 1 cent stays >= 19.99
    expect(computeNewPrice(1999, { mode: "amount", direction: "increase", value: 1 }, "end_99")).toBeGreaterThanOrEqual(1999);
  });

  it("always returns an integer", () => {
    for (const bps of [1, 33, 333, 1234, 9999]) {
      const out = computeNewPrice(1337, { mode: "percent", direction: "decrease", value: bps });
      expect(Number.isInteger(out)).toBe(true);
    }
  });
});

describe("roundPrice", () => {
  it("leaves prices alone when rounding is none but keeps the floor", () => {
    expect(roundPrice(1234, "none")).toBe(1234);
    expect(roundPrice(0, "none")).toBe(1);
  });
});

describe("isValidPriceChange", () => {
  it("rejects non-integers, negatives, zero prices and absurd percents", () => {
    expect(isValidPriceChange({ mode: "set", value: 0 })).toBe(false);
    expect(isValidPriceChange({ mode: "set", value: 10.5 })).toBe(false);
    expect(isValidPriceChange({ mode: "amount", direction: "decrease", value: -1 })).toBe(false);
    expect(isValidPriceChange({ mode: "percent", direction: "increase", value: 1_000_000 })).toBe(false);
    expect(isValidPriceChange({ mode: "percent", direction: "increase", value: 1500 })).toBe(true);
  });
});

describe("compare-at", () => {
  it("keeps the old price as compare-at on a decrease and clears it otherwise", () => {
    expect(resolveCompareAt(5000, 4000, "previous", null)).toBe(5000);
    expect(resolveCompareAt(5000, 6000, "previous", 7000)).toBeNull();
    expect(resolveCompareAt(5000, 5000, "previous", null)).toBeNull();
  });
  it("leaves compare-at untouched with none, removes it with clear", () => {
    expect(resolveCompareAt(5000, 4000, "none", 7000)).toBe(7000);
    expect(resolveCompareAt(5000, 4000, "clear", 7000)).toBeNull();
  });
});

describe("planProductPrices", () => {
  const rows = [
    { variantId: "a", sku: "A", priceCents: 4000, compareAtCents: null },
    { variantId: "b", sku: "B", priceCents: 5000, compareAtCents: null },
  ];
  it("plans every variant and reports the price range", () => {
    const plan = planProductPrices(rows, { mode: "percent", direction: "decrease", value: 1000 }, "none", "previous")!;
    expect(plan.variants.map((v) => v.after)).toEqual([3600, 4500]);
    expect(plan.beforeMin).toBe(4000);
    expect(plan.afterMax).toBe(4500);
    expect(plan.variants[0].compareAtAfter).toBe(4000);
    expect(plan.changed).toBe(true);
  });
  it("reports unchanged when nothing moves", () => {
    const plan = planProductPrices(rows, { mode: "amount", direction: "increase", value: 0 }, "none", "none")!;
    expect(plan.changed).toBe(false);
  });
  it("returns null for a product with no variants", () => {
    expect(planProductPrices([], { mode: "set", value: 100 }, "none", "none")).toBeNull();
  });
});

describe("uniqueCopySku", () => {
  it("appends -COPY and then a counter on collisions", () => {
    const taken = new Set<string>(["TEE-COPY", "tee-copy-2"]);
    expect(uniqueCopySku("TEE", taken)).toBe("TEE-COPY-3");
    expect(uniqueCopySku("TEE", taken)).toBe("TEE-COPY-4");
    expect(uniqueCopySku("HAT", taken)).toBe("HAT-COPY");
  });
});
