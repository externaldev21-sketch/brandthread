import { describe, expect, it } from "vitest";
import { MAX_STOCK, computeNewStock, isValidStockChange, planProductStock, stockLevel } from "./bulkStock";

describe("isValidStockChange", () => {
  it("accepts set / add / remove with whole non-negative numbers", () => {
    expect(isValidStockChange({ mode: "set", value: 0 })).toBe(true);
    expect(isValidStockChange({ mode: "set", value: 25 })).toBe(true);
    expect(isValidStockChange({ mode: "add", value: 5 })).toBe(true);
    expect(isValidStockChange({ mode: "remove", value: 5 })).toBe(true);
  });

  it("refuses bad modes, fractions, negatives, huge values and no-op deltas", () => {
    expect(isValidStockChange(null)).toBe(false);
    expect(isValidStockChange({ mode: "multiply", value: 2 })).toBe(false);
    expect(isValidStockChange({ mode: "set", value: 1.5 })).toBe(false);
    expect(isValidStockChange({ mode: "set", value: -1 })).toBe(false);
    expect(isValidStockChange({ mode: "set", value: "4" })).toBe(false);
    expect(isValidStockChange({ mode: "set", value: MAX_STOCK + 1 })).toBe(false);
    expect(isValidStockChange({ mode: "add", value: 0 })).toBe(false);
    expect(isValidStockChange({ mode: "remove", value: 0 })).toBe(false);
  });
});

describe("computeNewStock", () => {
  it("sets, adds and removes", () => {
    expect(computeNewStock(10, { mode: "set", value: 3 })).toBe(3);
    expect(computeNewStock(10, { mode: "add", value: 5 })).toBe(15);
    expect(computeNewStock(10, { mode: "remove", value: 4 })).toBe(6);
  });

  it("never goes below zero or above the cap", () => {
    expect(computeNewStock(3, { mode: "remove", value: 10 })).toBe(0);
    expect(computeNewStock(MAX_STOCK - 1, { mode: "add", value: 10 })).toBe(MAX_STOCK);
    expect(computeNewStock(-4, { mode: "add", value: 2 })).toBe(2);
  });
});

describe("stockLevel", () => {
  it("classifies against the variant's own threshold", () => {
    expect(stockLevel(0, 5)).toBe("out_of_stock");
    expect(stockLevel(5, 5)).toBe("low_stock");
    expect(stockLevel(6, 5)).toBe("in_stock");
  });
});

describe("planProductStock", () => {
  const rows = [
    { variantId: "a", sku: "S", stock: 2, lowStockThreshold: 5 },
    { variantId: "b", sku: "M", stock: 10, lowStockThreshold: 5 },
  ];

  it("returns null for a product with no variants", () => {
    expect(planProductStock([], { mode: "set", value: 4 })).toBeNull();
  });

  it("plans every variant and totals before/after", () => {
    const plan = planProductStock(rows, { mode: "remove", value: 4 })!;
    expect(plan.variants.map((v) => [v.before, v.after])).toEqual([[2, 0], [10, 6]]);
    expect(plan.beforeTotal).toBe(12);
    expect(plan.afterTotal).toBe(6);
    expect(plan.outAfter).toBe(1);
    expect(plan.lowAfter).toBe(0);
    expect(plan.changed).toBe(true);
  });

  it("flags low stock after the change and reports unchanged plans", () => {
    const low = planProductStock(rows, { mode: "set", value: 3 })!;
    expect(low.lowAfter).toBe(2);
    const same = planProductStock([{ variantId: "a", sku: "S", stock: 7, lowStockThreshold: 5 }], { mode: "set", value: 7 })!;
    expect(same.changed).toBe(false);
  });
});
